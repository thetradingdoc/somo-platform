/**
 * PAYMENT ORCHESTRATOR
 * 
 * Central service that handles ALL payment processing.
 * All protocols route through here.
 * 
 * Responsibilities:
 * 1. Validate payment requests
 * 2. Fetch product/merchant details
 * 3. Calculate totals
 * 4. Route to appropriate payment method
 * 5. Create checkout records
 * 6. Generate payment links/tokens
 * 7. Send SMS notifications
 * 8. Return standardized responses
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../database');
const PaymentRequest = require('../models/payment-request');
const PaymentResponse = require('../models/payment-response');
const PaymentService = require('./payment-service');
const SMSService = require('./sms-service');
const MastercardService = require('../services/mastercard-service');
const VisaService = require('../services/visa-service');

class PaymentOrchestrator {
    /**
     * Create a checkout session
     * 
     * @param {Object} requestData - Raw request data from any protocol
     * @returns {PaymentResponse}
     */
    static async createCheckout(requestData) {
        console.log('\n💳 PAYMENT ORCHESTRATOR: Creating Checkout');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        try {
            // Convert to standard format
            const paymentRequest = new PaymentRequest(requestData);

            console.log('📋 Request Summary:', paymentRequest.getSummary());

            // Validate request
            const validation = paymentRequest.validate();
            if (!validation.valid) {
                console.log('❌ Validation failed:', validation.errors);
                return new PaymentResponse({
                    success: false,
                    error: `Validation failed: ${validation.errors.join(', ')}`,
                    transaction_id: paymentRequest.transaction_id
                });
            }

            // Get merchant
            const merchant = db.getMerchant(paymentRequest.merchant_id);
            if (!merchant) {
                console.log('❌ Merchant not found:', paymentRequest.merchant_id);
                return new PaymentResponse({
                    success: false,
                    error: 'Merchant not found',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            console.log('✅ Merchant:', merchant.name);

            // If items don't have full details, fetch/fallback safely.
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

            // Calculate totals if not provided
            const totals = this._calculateTotals(enrichedItems, paymentRequest.totals);

            console.log('💰 Totals:', totals);

            // Get first item (primary product)
            const primaryItem = enrichedItems[0];

            // Create checkout record
            const checkoutId = uuidv4();
            const commerceQuoteId =
                requestData.commerce_quote_id ||
                requestData.metadata?.commerce_quote_id ||
                null;
            const shippingAddress =
                requestData.shipping_address ||
                requestData.metadata?.shipping_address ||
                requestData.customer?.shipping_address ||
                null;

            const checkout = {
                id: checkoutId,
                merchant_id: paymentRequest.merchant_id,
                product_id: primaryItem.product_id,
                product_name: primaryItem.name,
                quantity: primaryItem.quantity || 1,
                amount: totals.total,
                customer_phone: paymentRequest.customer?.phone || '',
                customer_name: paymentRequest.customer?.name || null,
                customer_email: paymentRequest.customer?.email || null,
                commerce_quote_id: commerceQuoteId,
                shipping_address: shippingAddress,
                status: 'pending'
            };

            db.createVoiceCheckout(checkout);
            console.log('✅ Checkout created:', checkoutId);

            // Route to payment method
            const paymentResult = await this._routePayment(
                paymentRequest.payment.method,
                checkout,
                merchant,
                paymentRequest
            );

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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

    /**
     * Enrich items with full product details
     * 
     * @private
     */
    static async _enrichItems(items, merchant) {
        const enriched = [];

        for (const item of items) {
            try {
                // If item already has full details, use it
                if (item.name && item.unit_price) {
                    enriched.push(item);
                    continue;
                }

                // Try external merchant API only when configured.
                if (merchant.api_url) {
                    try {
                        const response = await axios.get(
                            `${merchant.api_url}/api/products/${item.product_id}`,
                            { timeout: 8000 }
                        );
                        const product = response.data.product;
                        enriched.push({
                            product_id: item.product_id,
                            name: product.name,
                            quantity: item.quantity || 1,
                            unit_price: product.price,
                            total: (item.quantity || 1) * product.price
                        });
                        continue;
                    } catch (apiError) {
                        console.warn(`External product fetch failed for ${item.product_id}:`, apiError.message, '— falling back to local DB');
                    }
                }

                // Local DB fallback for local merchants and API failures.
                const localProduct = db.getProduct ? db.getProduct(item.product_id) : null;
                if (localProduct) {
                    enriched.push({
                        product_id: item.product_id,
                        name: localProduct.name,
                        quantity: item.quantity || 1,
                        unit_price: Number(localProduct.price),
                        total: (item.quantity || 1) * Number(localProduct.price)
                    });
                    continue;
                }

                throw new Error(`Product ${item.product_id} not found in external API or local DB`);
            } catch (error) {
                console.error(`Failed to enrich product ${item.product_id}:`, error.message);
                throw error;
            }
        }

        return enriched;
    }

    /**
     * Calculate totals
     * 
     * @private
     */
    static _calculateTotals(items, providedTotals = {}) {
        const subtotal = items.reduce((sum, item) => sum + item.total, 0);
        const tax = providedTotals.tax || 0;
        const shipping = providedTotals.shipping || 0;
        const total = subtotal + tax + shipping;

        return { subtotal, tax, shipping, total };
    }

    /**
     * Route to appropriate payment method
     * 
     * @private
     */
    static async _routePayment(paymentMethod, checkout, merchant, paymentRequest) {
        console.log('🔀 Routing to payment method:', paymentMethod);

        switch (paymentMethod) {
            case 'link':
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);

            case 'stripe':
            case 'direct_stripe':
                return await this._handleStripePayment(checkout, merchant, paymentRequest);

            case 'mastercard':
                return await this._handleMastercardPayment(checkout, merchant, paymentRequest);

            case 'visa':
                return await this._handleVisaPayment(checkout, merchant, paymentRequest);

            default:
                // Default to link-based payment
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }
    }

    /**
     * Handle link-based payment (SMS with payment page)
     * 
     * @private
     */
    static async _handleLinkPayment(checkout, merchant, paymentRequest) {
        console.log('🔗 Processing link-based payment');

        // Generate payment token
        const paymentToken = PaymentService.createPaymentToken(checkout.id);

        // Generate payment link
        const paymentLink = `${process.env.BASE_URL || 'http://localhost:4000'}/payment/${paymentToken}`;

        // Send SMS if phone number provided
        let smsResult = { success: false };
        if (checkout.customer_phone) {
            // Get customer_id from checkout if available
            const customerId = checkout.customer_id || null;
            const merchantId = merchant.id || null;
            
            smsResult = await SMSService.sendPaymentLink(
                checkout.customer_phone,
                paymentLink,
                {
                    product_name: checkout.product_name,
                    amount: checkout.amount.toFixed(2),
                    merchant_name: merchant.name
                },
                customerId,
                merchantId
            );

            console.log('📱 SMS Result:', smsResult.success ? '✅ Sent' : '❌ Failed');
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
            action_type: 'sms_link',
            message: smsResult.success
                ? 'Payment link sent via SMS'
                : 'Payment link generated (SMS failed)',
            metadata: {
                sms_sent: smsResult.success,
                sms_message_id: smsResult.message_sid
            }
        });
    }

    /**
     * Handle direct Stripe payment
     * Creates a Stripe Payment Intent for immediate processing
     * 
     * @private
     */
    static async _handleStripePayment(checkout, merchant, paymentRequest) {
        console.log('💳 Processing direct Stripe payment');

        try {
            const stripeConfig = require('../utils/stripe-config');
            const stripe = require('stripe')(stripeConfig.getStripeSecretKey());
            
            if (!stripe) {
                console.warn('⚠️ Stripe not configured, falling back to link payment');
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);
            }

            const piMetadata = {
                checkout_id: checkout.id,
                merchant_id: merchant.id,
                transaction_id: paymentRequest.transaction_id,
                customer_email: checkout.customer_email || '',
                customer_phone: checkout.customer_phone || ''
            };
            if (checkout.commerce_quote_id) {
                piMetadata.commerce_quote_id = checkout.commerce_quote_id;
            }

            // Create payment intent
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(checkout.amount * 100), // Convert to cents
                currency: paymentRequest.payment.currency.toLowerCase() || 'usd',
                automatic_payment_methods: {
                    enabled: true
                },
                return_url: `${process.env.BASE_URL || 'http://localhost:4000'}/api/payment/success`,
                metadata: piMetadata,
                description: `Payment for ${checkout.product_name || 'service'}`,
                receipt_email: checkout.customer_email || undefined
            });

            console.log('✅ Stripe Payment Intent created:', paymentIntent.id);

            return new PaymentResponse({
                success: true,
                transaction_id: paymentRequest.transaction_id,
                checkout_id: checkout.id,
                payment: {
                    method: 'stripe',
                    status: paymentIntent.status,
                    amount: checkout.amount,
                    currency: paymentRequest.payment.currency || 'USD',
                    payment_intent_id: paymentIntent.id,
                    client_secret: paymentIntent.client_secret
                },
                requires_action: paymentIntent.status === 'requires_action' || 
                                paymentIntent.status === 'requires_payment_method',
                action_type: paymentIntent.status === 'requires_action' ? 'stripe_3ds' : null,
                message: paymentIntent.status === 'succeeded' 
                    ? 'Payment processed successfully'
                    : 'Payment requires additional action',
                metadata: {
                    payment_intent_id: paymentIntent.id,
                    stripe_status: paymentIntent.status
                }
            });

        } catch (error) {
            console.error('❌ Stripe payment error:', error.message);
            return new PaymentResponse({
                success: false,
                error: `Stripe payment failed: ${error.message}`,
                transaction_id: paymentRequest.transaction_id
            });
        }
    }

    /**
     * Handle Mastercard Agent Pay
     * Processes payment via Mastercard's voice commerce protocol
     * 
     * @private
     */
    static async _handleMastercardPayment(checkout, merchant, paymentRequest) {
        console.log('🔴 Processing Mastercard Agent Pay');

        if (!MastercardService.isAvailable()) {
            console.warn('⚠️ Mastercard Agent Pay not configured, falling back to link payment');
            return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }

        try {
            // Get mandate from payment request metadata
            const mandate = paymentRequest.metadata?.mastercard_mandate;
            
            if (!mandate) {
                return new PaymentResponse({
                    success: false,
                    error: 'Mastercard mandate required for Agent Pay',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            // Verify mandate
            const mandateVerification = await MastercardService.verifyIntentMandate(mandate);
            if (!mandateVerification.valid) {
                return new PaymentResponse({
                    success: false,
                    error: `Mandate verification failed: ${mandateVerification.error}`,
                    transaction_id: paymentRequest.transaction_id
                });
            }

            // Process payment
            const paymentResult = await MastercardService.processPayment({
                mandateId: mandate.id,
                amount: checkout.amount,
                currency: paymentRequest.payment.currency || 'USD',
                description: `Payment for ${checkout.product_name || 'service'}`
            });

            if (!paymentResult.success) {
                return new PaymentResponse({
                    success: false,
                    error: paymentResult.error || 'Mastercard payment failed',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            return new PaymentResponse({
                success: true,
                transaction_id: paymentRequest.transaction_id,
                checkout_id: checkout.id,
                payment: {
                    method: 'mastercard',
                    status: 'completed',
                    amount: checkout.amount,
                    currency: paymentRequest.payment.currency || 'USD'
                },
                message: 'Payment processed via Mastercard Agent Pay',
                metadata: {
                    mastercard_transaction_id: paymentResult.transaction_id,
                    mandate_id: mandate.id
                }
            });

        } catch (error) {
            console.error('❌ Mastercard payment error:', error.message);
            return new PaymentResponse({
                success: false,
                error: `Mastercard payment failed: ${error.message}`,
                transaction_id: paymentRequest.transaction_id
            });
        }
    }

    /**
     * Handle Visa Agent Toolkit
     * Processes payment via Visa's voice commerce protocol
     * 
     * @private
     */
    static async _handleVisaPayment(checkout, merchant, paymentRequest) {
        console.log('🔵 Processing Visa Agent Toolkit');

        if (!VisaService.isAvailable()) {
            console.warn('⚠️ Visa Agent Toolkit not configured, falling back to link payment');
            return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }

        try {
            // Get mandate from payment request metadata
            const mandate = paymentRequest.metadata?.visa_mandate;
            
            if (!mandate) {
                return new PaymentResponse({
                    success: false,
                    error: 'Visa mandate required for Agent Toolkit',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            // Verify mandate
            const mandateVerification = await VisaService.verifyIntentMandate(mandate);
            if (!mandateVerification.valid) {
                return new PaymentResponse({
                    success: false,
                    error: `Mandate verification failed: ${mandateVerification.error}`,
                    transaction_id: paymentRequest.transaction_id
                });
            }

            // Process payment
            const paymentResult = await VisaService.processPayment({
                mandateId: mandate.id,
                amount: checkout.amount,
                currency: paymentRequest.payment.currency || 'USD',
                description: `Payment for ${checkout.product_name || 'service'}`
            });

            if (!paymentResult.success) {
                return new PaymentResponse({
                    success: false,
                    error: paymentResult.error || 'Visa payment failed',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            return new PaymentResponse({
                success: true,
                transaction_id: paymentRequest.transaction_id,
                checkout_id: checkout.id,
                payment: {
                    method: 'visa',
                    status: 'completed',
                    amount: checkout.amount,
                    currency: paymentRequest.payment.currency || 'USD'
                },
                message: 'Payment processed via Visa Agent Toolkit',
                metadata: {
                    visa_transaction_id: paymentResult.transaction_id,
                    mandate_id: mandate.id
                }
            });

        } catch (error) {
            console.error('❌ Visa payment error:', error.message);
            return new PaymentResponse({
                success: false,
                error: `Visa payment failed: ${error.message}`,
                transaction_id: paymentRequest.transaction_id
            });
        }
    }

    /**
     * Get checkout status
     * 
     * @param {string} checkoutId
     * @returns {PaymentResponse}
     */
    static async getCheckoutStatus(checkoutId) {
        try {
            const checkout = db.getVoiceCheckout(checkoutId);

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