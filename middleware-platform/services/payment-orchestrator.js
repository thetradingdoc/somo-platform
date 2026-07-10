// services/payment-orchestrator.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../database');
const { ensureMerchantOrderFromVoiceCheckout } = require('./ensure-merchant-order-from-voice-checkout');
const PaymentRequest = require('../models/payment-request');
const PaymentResponse = require('../models/payment-response');
const PaymentService = require('./payment-service');
const stripeConfig = require('../utils/stripe-config');
const SMSService = require('./sms-service');
const EmailService = require('./email-service');
const constants = require('../utils/constants');

class PaymentOrchestrator {
    /** Stripe metadata — opaque IDs only; no raw email/phone (Phase 0.2). */
    static _stripePaymentMetadata(checkout, merchant, extra = {}) {
        const meta = {
            checkout_id: String(checkout?.id || ''),
            merchant_id: String(merchant?.id || checkout?.merchant_id || ''),
            ...extra
        };
        if (checkout?.appointment_id) meta.appointment_id = String(checkout.appointment_id);
        if (checkout?.call_id) meta.call_id = String(checkout.call_id);
        if (checkout?.commerce_quote_id) meta.commerce_quote_id = String(checkout.commerce_quote_id);
        if (checkout?.customer_id) meta.customer_id = String(checkout.customer_id);
        return meta;
    }

    static async createCheckout(requestData, tenantContext = null) {
        const quietReplay =
            String(process.env.PSTN_REPLAY_QUIET_LOGS || '').trim() === '1' &&
            String(process.env.PSTN_REPLAY_COMMERCE || '').trim() === '1';
        if (!quietReplay) {
            console.log('\n💳 PAYMENT ORCHESTRATOR: Creating Checkout');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }

        try {
            // Convert to standard format
            const paymentRequest = new PaymentRequest(requestData);
            
            // Attach tenant context if provided (for merchant resolution)
            if (tenantContext) {
                requestData.tenantContext = tenantContext;
            }

            const PaymentSecurity = require('./payment-security');
            if (!quietReplay) {
                console.log('📋 Request Summary:', JSON.stringify(PaymentSecurity.sanitizeForLog(paymentRequest.getSummary())));
            }

            // Validate request (merchant_id is optional - fallback will handle it)
            const validation = paymentRequest.validate();

            const {
              buildCopayIdempotencyKey,
              extractCopayKeysFromRequest
            } = require('./payment-idempotency');
            const copayKeys = extractCopayKeysFromRequest(requestData);
            const copayIdem = buildCopayIdempotencyKey(copayKeys);
            if (copayIdem && db.getIdempotentResult) {
              const cached = db.getIdempotentResult(copayIdem, 'copay_checkout');
              if (cached?.result) {
                return new PaymentResponse({ ...cached.result, idempotent: true });
              }
            }
            if (!validation.valid) {
                // Filter out merchant_id requirement - we'll handle it with fallback
                const nonMerchantErrors = validation.errors.filter(e => !e.includes('merchant_id'));
                if (nonMerchantErrors.length > 0) {
                    console.log('❌ Validation failed:', nonMerchantErrors);
                    return new PaymentResponse({
                        success: false,
                        error: `Validation failed: ${nonMerchantErrors.join(', ')}`,
                        transaction_id: paymentRequest.transaction_id
                    });
                }
                // If only merchant_id is missing, continue to fallback logic
                console.log('⚠️  merchant_id missing - will use fallback logic');
            }

            // Get merchant - try provided merchant_id first
            let merchant = paymentRequest.merchant_id ? db.getMerchant(paymentRequest.merchant_id) : null;

            // If merchant not found, check if tenant context is available (from middleware)
            // Note: This requires the route to use tenantContext middleware
            if (!merchant && requestData.tenantContext) {
                const tenant = requestData.tenantContext;
                if (tenant.validated) {
                    if (tenant.merchant) {
                        merchant = tenant.merchant;
                        paymentRequest.merchant_id = merchant.id;
                        console.log('✅ Using merchant from tenant context:', merchant.name);
                    } else if (tenant.clinic && tenant.clinic.merchant_id) {
                        merchant = db.getMerchant(tenant.clinic.merchant_id);
                        if (merchant) {
                            paymentRequest.merchant_id = merchant.id;
                            console.log('✅ Using merchant from clinic association:', merchant.name);
                        }
                    }
                }
            }

            // Final validation - return error instead of fallback (for security)
            if (!merchant) {
                console.log('❌ ERROR: Could not determine merchant');
                console.log('   Provided merchant_id:', paymentRequest.merchant_id);
                return new PaymentResponse({
                    success: false,
                    error: 'Merchant not found. Please ensure merchant is configured in the system.',
                    message: 'Could not determine merchant from request. Please provide merchant_id or ensure tenant context is available.',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            if (!quietReplay) {
                console.log('✅ Merchant found:', merchant.name, '(ID:', merchant.id + ')');
            }

            // Enrich items with full details
            const enrichedItems = await this._enrichItems(paymentRequest.items, merchant);

            // CRITICAL: Validate that we have at least one item
            if (!enrichedItems || enrichedItems.length === 0) {
                console.log('❌ No items to checkout');
                return new PaymentResponse({
                    success: false,
                    error: 'No items in checkout. Please add at least one product.',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            // Calculate totals
            const totals = this._calculateTotals(enrichedItems, paymentRequest.totals);

            if (!quietReplay) console.log('💰 Totals:', totals);

            // Normalize phone number (ensure it's never null)
            const normalizedPhone = paymentRequest.customer?.phone 
                ? SMSService.formatPhoneNumber(paymentRequest.customer.phone)
                : '0000000000';

            // Get first item (primary product)
            const primaryItem = enrichedItems[0];

            const commerceQuoteId =
                (paymentRequest.metadata && paymentRequest.metadata.commerce_quote_id) || null;
            const shippingAddr =
                paymentRequest.shipping_address ||
                (paymentRequest.metadata && paymentRequest.metadata.shipping_address) ||
                null;

            // Create checkout record
            const checkoutId = uuidv4();
            const checkout = {
                id: checkoutId,
                merchant_id: paymentRequest.merchant_id,
                product_id: primaryItem.product_id,
                product_name: primaryItem.name,
                quantity: primaryItem.quantity || 1,
                amount: totals.total,
                customer_phone: normalizedPhone,
                customer_name: paymentRequest.customer?.name || null,
                customer_email: paymentRequest.customer?.email || null,
                commerce_quote_id: commerceQuoteId,
                shipping_address: shippingAddr,
                status: 'pending'
            };

            await db.createVoiceCheckout(checkout);
            if (copayIdem && copayKeys.callId) {
              try {
                db.db?.prepare('UPDATE voice_checkouts SET call_id = ?, appointment_id = ? WHERE id = ?').run(
                  copayKeys.callId,
                  copayKeys.appointmentId || null,
                  checkoutId
                );
              } catch (_) {}
            }
            if (!quietReplay) console.log('✅ Checkout created:', checkoutId);

            // Route to payment method
            const paymentResult = await this._routePayment(
                paymentRequest.payment.method,
                checkout,
                merchant,
                paymentRequest
            );

            if (copayIdem && paymentResult?.success && db.completeIdempotentResult) {
              try {
                db.completeIdempotentResult(copayIdem, 'copay_checkout', {
                  success: paymentResult.success,
                  transaction_id: paymentResult.transaction_id,
                  checkout_id: paymentResult.checkout_id,
                  payment: paymentResult.payment,
                  payment_link: paymentResult.payment_link,
                  payment_token: paymentResult.payment_token,
                  message: paymentResult.message
                });
              } catch (_) {}
            }

            if (!quietReplay) console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            return paymentResult;

        } catch (error) {
            console.error('❌ Orchestrator error:', error);
            return new PaymentResponse({
                success: false,
                error: error.message,
                transaction_id: requestData.transaction_id
            });
        }
    }

    static async _enrichItems(items, merchant) {
        const enriched = [];

        for (const item of items) {
            try {
                if (item.name && item.unit_price) {
                    enriched.push(item);
                    continue;
                }

                // Fetch product directly from database (merged merchant-shop)
                const product = db.getProduct(item.product_id);
                if (!product) {
                    throw new Error(`Product ${item.product_id} not found`);
                }

                enriched.push({
                    product_id: item.product_id,
                    name: product.name,
                    quantity: item.quantity || 1,
                    unit_price: product.price,
                    total: (item.quantity || 1) * product.price
                });

            } catch (error) {
                console.error(`Failed to fetch product ${item.product_id}:`, error.message);
                throw new Error(`Product ${item.product_id} not found`);
            }
        }

        return enriched;
    }

    static _calculateTotals(items, providedTotals = {}) {
        // Subtotal from enriched line items (DB prices only). Never accept client-provided subtotal/total for capture.
        const subtotal = items.reduce((sum, item) => sum + item.total, 0);
        const tax = providedTotals.tax || 0;
        const shipping = providedTotals.shipping || 0;
        const total = subtotal + tax + shipping;

        return { subtotal, tax, shipping, total };
    }

    static async _routePayment(paymentMethod, checkout, merchant, paymentRequest) {
        const PaymentMethodConfig = require('./payment-method-config');
        const method = (paymentMethod || 'link').toString().trim().toLowerCase();
        const normalized = method === 'direct_stripe' ? 'stripe' : method;

        if (!PaymentMethodConfig.isPaymentMethodAllowed(normalized, merchant?.id)) {
            console.warn(`⚠️  Payment method "${method}" not allowed, falling back to link`);
            return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }

        console.log('🔀 Routing to payment method:', method);

        switch (normalized === 'stripe' ? (paymentMethod || 'stripe') : normalized) {
            case 'stripe':
            case 'direct_stripe':
                return await this._handleStripePayment(checkout, merchant, paymentRequest);
            case 'mastercard':
                return await this._handleMastercardPayment(checkout, merchant, paymentRequest);
            case 'visa':
                return await this._handleVisaPayment(checkout, merchant, paymentRequest);
            case 'link':
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);
            default:
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }
    }

    /**
     * Direct Stripe Payment Intent (PAYMENT_ARCHITECTURE TODO 1).
     * Process payment immediately when card/payment_method available; no email verification.
     * Creates PaymentIntent with metadata (checkout_id, merchant_id).
     * Handles requires_action (3DS), returns client_secret for client-side confirmation.
     */
    static async _handleStripePayment(checkout, merchant, paymentRequest) {
        console.log('💳 Processing Direct Stripe Payment Intent');

        let stripeSecret;
        try {
            stripeSecret = stripeConfig.getStripeSecretKey();
        } catch (_) {
            console.error('❌ Stripe secret key not configured');
            return new PaymentResponse({
                success: false,
                error: 'Stripe is not configured. Please use link payment.',
                transaction_id: paymentRequest.transaction_id
            });
        }

        const stripe = require('stripe')(stripeSecret);
        const amountCents = Math.round((checkout.amount || 0) * 100);
        const paymentMethodId = paymentRequest.payment?.payment_method_id || paymentRequest.metadata?.payment_method_id;

        try {
            const metaExtra = {};
            const cq =
                checkout.commerce_quote_id ||
                (paymentRequest.metadata && paymentRequest.metadata.commerce_quote_id);
            if (cq) metaExtra.commerce_quote_id = String(cq);
            const ks = paymentRequest.metadata && paymentRequest.metadata.kelly_session_id;
            if (ks) metaExtra.kelly_session_id = String(ks);
            const csid = paymentRequest.metadata && paymentRequest.metadata.cart_session_id;
            if (csid) metaExtra.cart_session_id = String(csid);
            const createParams = {
                amount: amountCents,
                currency: 'usd',
                automatic_payment_methods: { enabled: true },
                metadata: PaymentOrchestrator._stripePaymentMetadata(checkout, merchant, {
                    transaction_id: paymentRequest.transaction_id || '',
                    ...metaExtra
                })
            };

            if (paymentMethodId) {
                createParams.payment_method = paymentMethodId;
                createParams.confirm = true;
                const base = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
                createParams.return_url = `${base}/api/payment/success`;
            }

            const paymentIntent = await stripe.paymentIntents.create(createParams);

            if (
                paymentIntent.status === 'requires_payment_method' ||
                paymentIntent.status === 'requires_action' ||
                paymentIntent.status === 'requires_source_action'
            ) {
                const needsPaymentMethod = paymentIntent.status === 'requires_payment_method';
                console.log(
                    needsPaymentMethod
                        ? 'ℹ️  PaymentIntent created and awaiting payment method'
                        : '⚠️  Payment requires additional action (3DS)'
                );
                await db.updateVoiceCheckout(checkout.id, {
                    status: 'pending',
                    payment_intent_id: paymentIntent.id,
                    payment_method: 'stripe'
                });
                return new PaymentResponse({
                    success: true,
                    transaction_id: paymentRequest.transaction_id,
                    checkout_id: checkout.id,
                    payment: {
                        method: 'stripe',
                        status: paymentIntent.status,
                        amount: checkout.amount,
                        currency: 'USD',
                        payment_intent_id: paymentIntent.id,
                        client_secret: paymentIntent.client_secret
                    },
                    requires_action: true,
                    client_secret: paymentIntent.client_secret,
                    payment_intent_id: paymentIntent.id,
                    message: needsPaymentMethod
                        ? 'Payment method required to complete checkout'
                        : 'Additional authentication required (3D Secure)',
                    metadata: {
                        action_type: needsPaymentMethod ? 'collect_payment_method' : 'authenticate'
                    }
                });
            }

            if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
                await db.updateVoiceCheckout(checkout.id, {
                    status: 'completed',
                    payment_intent_id: paymentIntent.id,
                    payment_method: 'stripe'
                });
                try {
                    const fresh = await db.getVoiceCheckout(checkout.id);
                    if (fresh) {
                        const webhookOnly = process.env.COMMERCE_ORDER_FROM_WEBHOOK_ONLY === '1'
                            || process.env.COMMERCE_ORDER_FROM_WEBHOOK_ONLY === 'true';
                        if (webhookOnly) {
                            console.log('[PaymentOrchestrator] skipping ensureMerchantOrderFromVoiceCheckout (COMMERCE_ORDER_FROM_WEBHOOK_ONLY)');
                        } else {
                            await ensureMerchantOrderFromVoiceCheckout(paymentIntent, fresh, { source: 'orchestrator' });
                        }
                        try {
                            const { finalizeCommerceRetailPayment } = require('./commerce-payment-settlement');
                            await finalizeCommerceRetailPayment(paymentIntent, paymentIntent.amount);
                        } catch (e) {
                            console.warn('[PaymentOrchestrator] finalizeCommerceRetailPayment:', e.message);
                        }
                    }
                } catch (e) {
                    console.warn('[PaymentOrchestrator] ensureMerchantOrderFromVoiceCheckout:', e.message);
                }
                return new PaymentResponse({
                    success: true,
                    transaction_id: paymentRequest.transaction_id,
                    checkout_id: checkout.id,
                    payment: {
                        method: 'stripe',
                        status: paymentIntent.status,
                        amount: checkout.amount,
                        currency: 'USD'
                    },
                    payment_intent_id: paymentIntent.id,
                    message: 'Payment successful',
                    metadata: { completed: true }
                });
            }

            return new PaymentResponse({
                success: false,
                error: `Payment status: ${paymentIntent.status}`,
                transaction_id: paymentRequest.transaction_id,
                payment_intent_id: paymentIntent.id
            });

        } catch (stripeError) {
            console.error('❌ Stripe Payment Intent error:', stripeError.message);
            const isDecline = stripeError.type === 'StripeCardError' || stripeError.code === 'card_declined';
            const isNetwork = stripeError.type === 'StripeConnectionError' || stripeError.code === 'api_connection_error';
            const message = isDecline
                ? (stripeError.message || 'Card was declined')
                : isNetwork
                    ? 'Network error. Please try again.'
                    : (stripeError.message || 'Payment failed');
            return new PaymentResponse({
                success: false,
                error: message,
                transaction_id: paymentRequest.transaction_id,
                stripe_error_type: stripeError.type,
                stripe_error_code: stripeError.code
            });
        }
    }

    /**
     * Mastercard Agent Pay (PAYMENT_ARCHITECTURE TODO 2).
     * Voice commerce payment via Mastercard mandate.
     * Requires: MASTERCARD_AGENT_PAY_* credentials, mandate_id in payment request.
     */
    static async _handleMastercardPayment(checkout, merchant, paymentRequest) {
        console.log('💳 Processing Mastercard Agent Pay');

        const MastercardService = require('./mastercard-agent-pay-service');
        if (!MastercardService.isConfigured()) {
            console.warn('⚠️  Mastercard Agent Pay not configured, falling back to link');
            return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }

        try {
            const result = await MastercardService.authorizeAndPay(checkout, merchant, paymentRequest);

            if (!result.success) {
                return new PaymentResponse({
                    success: false,
                    error: result.error || 'Mastercard payment failed',
                    transaction_id: paymentRequest.transaction_id,
                    fallback_suggested: 'link'
                });
            }

            await db.updateVoiceCheckout(checkout.id, {
                status: 'completed',
                payment_intent_id: result.transactionId,
                payment_method: 'mastercard'
            });

            return new PaymentResponse({
                success: true,
                transaction_id: paymentRequest.transaction_id,
                checkout_id: checkout.id,
                payment: {
                    method: 'mastercard',
                    status: 'succeeded',
                    amount: checkout.amount,
                    currency: 'USD'
                },
                payment_intent_id: result.transactionId,
                message: 'Payment successful via Mastercard Agent Pay',
                metadata: { completed: true }
            });
        } catch (err) {
            console.error('❌ Mastercard Agent Pay error:', err.message);
            return new PaymentResponse({
                success: false,
                error: err.message || 'Mastercard payment failed',
                transaction_id: paymentRequest.transaction_id,
                fallback_suggested: 'link'
            });
        }
    }

    /**
     * Visa Agent Toolkit (PAYMENT_ARCHITECTURE TODO 3).
     * Voice commerce payment via Visa mandate.
     * Requires: VISA_AGENT_TOOLKIT_* credentials, mandate_id in payment request.
     */
    static async _handleVisaPayment(checkout, merchant, paymentRequest) {
        console.log('💳 Processing Visa Agent Toolkit');

        const VisaService = require('./visa-agent-toolkit-service');
        if (!VisaService.isConfigured()) {
            console.warn('⚠️  Visa Agent Toolkit not configured, falling back to link');
            return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }

        try {
            const result = await VisaService.authorizeAndPay(checkout, merchant, paymentRequest);

            if (!result.success) {
                return new PaymentResponse({
                    success: false,
                    error: result.error || 'Visa payment failed',
                    transaction_id: paymentRequest.transaction_id,
                    fallback_suggested: 'link'
                });
            }

            await db.updateVoiceCheckout(checkout.id, {
                status: 'completed',
                payment_intent_id: result.transactionId,
                payment_method: 'visa'
            });

            return new PaymentResponse({
                success: true,
                transaction_id: paymentRequest.transaction_id,
                checkout_id: checkout.id,
                payment: {
                    method: 'visa',
                    status: 'succeeded',
                    amount: checkout.amount,
                    currency: 'USD'
                },
                payment_intent_id: result.transactionId,
                message: 'Payment successful via Visa Agent Toolkit',
                metadata: { completed: true }
            });
        } catch (err) {
            console.error('❌ Visa Agent Toolkit error:', err.message);
            return new PaymentResponse({
                success: false,
                error: err.message || 'Visa payment failed',
                transaction_id: paymentRequest.transaction_id,
                fallback_suggested: 'link'
            });
        }
    }

    static async _handleLinkPayment(checkout, merchant, paymentRequest) {
        const quietReplay =
            String(process.env.PSTN_REPLAY_QUIET_LOGS || '').trim() === '1' &&
            String(process.env.PSTN_REPLAY_COMMERCE || '').trim() === '1';
        if (!quietReplay) console.log('🔗 Processing link-based payment');

        // Generate payment token
        const paymentToken = PaymentService.createPaymentToken(checkout.id);

        // Generate payment link
        const paymentLink = `${process.env.BASE_URL || 'http://localhost:4000'}/payment/${paymentToken}`;

        // Email verification is required before checkout (enforced in /voice/checkout/create)
        // Payment link is ALWAYS sent via email (no SMS fallback)
        const EmailVerificationService = require('./email-verification-service');
        const emailVerified = checkout.customer_email 
            ? EmailVerificationService.isEmailVerified(checkout.customer_email)
            : false;

        // Require email for payment link
        if (!checkout.customer_email) {
            console.error('❌ No email provided for payment link');
            return new PaymentResponse({
                success: false,
                error: 'Email address is required to send payment link',
                transaction_id: paymentRequest.transaction_id
            });
        }

        if (!emailVerified) {
            console.error('❌ Email not verified for payment link');
            return new PaymentResponse({
                success: false,
                error: 'Email must be verified before sending payment link',
                requires_verification: true,
                transaction_id: paymentRequest.transaction_id
            });
        }

        // Send payment link via email (always - no SMS fallback)
        const emailResult = await EmailService.sendPaymentLinkEmail(
            checkout.customer_email,
            paymentLink,
            {
                product_name: checkout.product_name,
                amount: checkout.amount
            }
        );
        if (!quietReplay) {
            console.log('📧 Payment link email sent:', emailResult.success ? '✅ Sent' : '❌ Failed');
        }
        
        if (!emailResult.success) {
            if (!quietReplay) console.error('❌ Failed to send payment link email:', emailResult.error);
            if (process.env.PSTN_REPLAY_COMMERCE === '1') {
                return new PaymentResponse({
                    success: true,
                    transaction_id: paymentRequest.transaction_id,
                    checkout_id: checkout.id,
                    payment: {
                        method: 'link',
                        status: 'pending',
                        amount: checkout.amount,
                        currency: 'USD'
                    },
                    payment_link: paymentLink,
                    payment_token: paymentToken,
                    requires_action: true,
                    action_type: 'email_link',
                    message: `Payment link ready for ${checkout.customer_email} (replay: email skipped)`,
                    metadata: {
                        email_sent: false,
                        replay_email_skipped: true
                    }
                });
            }
            return new PaymentResponse({
                success: false,
                error: 'Failed to send payment link email. Please try again.',
                transaction_id: paymentRequest.transaction_id
            });
        }

        return new PaymentResponse({
            success: true,
            transaction_id: paymentRequest.transaction_id,
            checkout_id: checkout.id,
            payment: {
                method: 'link',
                status: 'pending',
                amount: checkout.amount,
                currency: 'USD'
            },
            payment_link: paymentLink,
            payment_token: paymentToken,
            requires_action: true,
            action_type: 'email_link',
            message: `Payment link sent to ${checkout.customer_email}`,
            metadata: {
                email_sent: true,
                email_message_id: emailResult.message_id
            }
        });
    }

    /**
     * Create Stripe Payment Intent only (no confirmation).
     * Returns client_secret for client-side Stripe.js confirmation.
     * Use when caller will collect card and confirm via Stripe.js.
     */
    static async createStripePaymentIntent(checkoutId, amount, merchantId = null) {
        let stripeSecret;
        try {
            stripeSecret = stripeConfig.getStripeSecretKey();
        } catch (_) {
            return { success: false, error: 'Stripe is not configured' };
        }
        const checkout = await db.getVoiceCheckout(checkoutId);
        if (!checkout) return { success: false, error: 'Checkout not found' };
        const merchant = merchantId ? db.getMerchant(merchantId) : db.getMerchant(checkout.merchant_id);
        const amountCents = Math.round((amount ?? checkout.amount ?? 0) * 100);
        if (amountCents < 50) return { success: false, error: 'Amount must be at least $0.50' };

        try {
            const stripe = require('stripe')(stripeSecret);
            const baseUrl = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
            const piMeta = PaymentOrchestrator._stripePaymentMetadata(checkout, merchant);
            if (checkout.commerce_quote_id) {
                piMeta.commerce_quote_id = String(checkout.commerce_quote_id);
            }
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountCents,
                currency: 'usd',
                automatic_payment_methods: { enabled: true },
                return_url: `${baseUrl}/api/payment/success`,
                metadata: piMeta
            });
            return {
                success: true,
                client_secret: paymentIntent.client_secret,
                payment_intent_id: paymentIntent.id,
                requires_action: paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_action'
            };
        } catch (err) {
            console.error('❌ createStripePaymentIntent error:', err.message);
            return {
                success: false,
                error: err.message || 'Failed to create Payment Intent',
                stripe_error_type: err.type,
                stripe_error_code: err.code
            };
        }
    }

    static async getCheckoutStatus(checkoutId) {
        try {
            const checkout = await db.getVoiceCheckout(checkoutId);

            if (!checkout) {
                return new PaymentResponse({
                    success: false,
                    error: 'Checkout not found'
                });
            }

            return new PaymentResponse({
                success: true,
                checkout_id: checkout.id,
                payment: {
                    status: checkout.status,
                    amount: checkout.amount,
                    currency: 'USD',
                    payment_intent_id: checkout.payment_intent_id
                },
                merchant_order_id: checkout.merchant_order_id,
                metadata: {
                    created_at: checkout.created_at,
                    completed_at: checkout.completed_at
                }
            });

        } catch (error) {
            return new PaymentResponse({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = PaymentOrchestrator;