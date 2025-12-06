// services/payment-orchestrator.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../database');
const PaymentRequest = require('../models/payment-request');
const PaymentResponse = require('../models/payment-response');
const PaymentService = require('./payment-service');
const SMSService = require('./sms-service');
const EmailService = require('./email-service');

class PaymentOrchestrator {
    static async createCheckout(requestData) {
        console.log('\n💳 PAYMENT ORCHESTRATOR: Creating Checkout');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        try {
            // Convert to standard format
            const paymentRequest = new PaymentRequest(requestData);

            console.log('📋 Request Summary:', paymentRequest.getSummary());

            // Validate request (merchant_id is optional - fallback will handle it)
            const validation = paymentRequest.validate();
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

            // Get merchant - with fallback logic for invalid or missing merchant_id
            let merchant = paymentRequest.merchant_id ? db.getMerchant(paymentRequest.merchant_id) : null;

            // FALLBACK: If merchant not found, try to determine from context
            if (!merchant) {
                console.log('⚠️  Merchant not found by ID, trying fallback methods...');
                console.log('   Provided merchant_id:', paymentRequest.merchant_id);
                
                // Method 1: Try to find merchant by subdomain (akin-dunbar)
                const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
                if (fallbackMerchant) {
                    console.log('✅ Found merchant by subdomain (akin-dunbar):', fallbackMerchant.id);
                    merchant = fallbackMerchant;
                    // Update paymentRequest with correct merchant_id
                    paymentRequest.merchant_id = merchant.id;
                } else {
                    // Method 2: Try to get first active merchant (last resort)
                    const allMerchants = db.getAllMerchants();
                    if (allMerchants && allMerchants.length > 0) {
                        // Prefer merchants with subdomain 'akin-dunbar' or first active one
                        const preferredMerchant = allMerchants.find(m => m.subdomain === 'akin-dunbar') || allMerchants[0];
                        console.log('⚠️  Using fallback merchant:', preferredMerchant.id, preferredMerchant.name);
                        merchant = preferredMerchant;
                        paymentRequest.merchant_id = merchant.id;
                    }
                }
            }

            // Final validation
            if (!merchant) {
                console.log('❌ ERROR: Could not determine merchant');
                return new PaymentResponse({
                    success: false,
                    error: 'Merchant not found. Please ensure merchant is configured in the system.',
                    transaction_id: paymentRequest.transaction_id
                });
            }

            console.log('✅ Merchant found:', merchant.name, '(ID:', merchant.id + ')');

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

            console.log('💰 Totals:', totals);

            // Normalize phone number (ensure it's never null)
            const normalizedPhone = paymentRequest.customer?.phone 
                ? SMSService.formatPhoneNumber(paymentRequest.customer.phone)
                : '0000000000';

            // Get first item (primary product)
            const primaryItem = enrichedItems[0];

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
                status: 'pending'
            };

            await db.createVoiceCheckout(checkout);
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
        const subtotal = items.reduce((sum, item) => sum + item.total, 0);
        const tax = providedTotals.tax || 0;
        const shipping = providedTotals.shipping || 0;
        const total = subtotal + tax + shipping;

        return { subtotal, tax, shipping, total };
    }

    static async _routePayment(paymentMethod, checkout, merchant, paymentRequest) {
        console.log('🔀 Routing to payment method:', paymentMethod);

        switch (paymentMethod) {
            case 'link':
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);
            default:
                return await this._handleLinkPayment(checkout, merchant, paymentRequest);
        }
    }

    static async _handleLinkPayment(checkout, merchant, paymentRequest) {
        console.log('🔗 Processing link-based payment');

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
        console.log('📧 Payment link email sent:', emailResult.success ? '✅ Sent' : '❌ Failed');
        
        if (!emailResult.success) {
            console.error('❌ Failed to send payment link email:', emailResult.error);
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