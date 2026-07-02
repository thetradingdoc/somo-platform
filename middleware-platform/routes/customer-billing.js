/**
 * CUSTOMER BILLING ROUTES
 * 
 * Pay-as-you-go billing, usage tracking, and Stripe checkout integration
 */

const express = require('express');
const db = require('../database');
const stripeConfig = require('../utils/stripe-config');
const stripe = stripeConfig.initializeStripe();
const { authLimiter } = require('../middleware/rate-limiter');

const router = express.Router();

/**
 * Helper to get customer from session
 */
function getCustomerFromSession(req) {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
        return null;
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
        return null;
    }

    return db.getCustomer(session.customer_id);
}

/**
 * GET /api/customer/billing/usage
 * Get current month usage and costs
 */
router.get('/usage', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        const now = new Date();
        const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Get monthly usage
        const usage = db.getMonthlyUsage(customer.id, billingMonth);

        // Get call costs from voice_call_log
        const callCosts = db.getVoiceCallCostsByCustomer(customer.id);

        // Calculate totals
        const voiceMinutes = usage?.voice_minutes_used || 0;
        const apiRequests = usage?.api_requests_used || 0;

        // Cost per minute: $0.083 (Twilio $0.013 + Retell $0.07)
        const costPerMinute = 0.083;
        const phoneNumberMonthlyFee = 1.50; // $1.50/month per number

        const voiceCost = voiceMinutes * costPerMinute;
        const totalCost = voiceCost + phoneNumberMonthlyFee;

        // Get current invoice if exists
        const currentInvoice = db.getMonthlyInvoiceByCustomerAndMonth(customer.id, billingMonth);

        res.json({
            success: true,
            billing_month: billingMonth,
            usage: {
                voice_minutes: voiceMinutes,
                api_requests: apiRequests,
                phone_number_fee: phoneNumberMonthlyFee
            },
            costs: {
                voice_cost: voiceCost,
                phone_number_fee: phoneNumberMonthlyFee,
                total: totalCost,
                cost_per_minute: costPerMinute
            },
            invoice: currentInvoice ? {
                id: currentInvoice.id,
                status: currentInvoice.status,
                total: currentInvoice.total,
                due_date: currentInvoice.due_date
            } : null,
            payment_method: customer.stripe_payment_method_id ? {
                has_payment_method: true,
                card_last4: customer.card_last4,
                card_brand: customer.card_brand
            } : {
                has_payment_method: false
            }
        });
    } catch (error) {
        console.error('❌ Get usage error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get usage',
            message: error.message
        });
    }
});

/**
 * POST /api/customer/billing/checkout
 * Create Stripe checkout session for payment method setup
 */
router.post('/checkout', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Stripe not configured'
            });
        }

        // Get current usage to show in checkout
        const now = new Date();
        const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usage = db.getMonthlyUsage(customer.id, billingMonth);
        const voiceMinutes = usage?.voice_minutes_used || 0;
        const costPerMinute = 0.083;
        const phoneNumberFee = 1.50;
        const voiceCost = voiceMinutes * costPerMinute;
        const totalAmount = Math.max(voiceCost + phoneNumberFee, 0.50); // Minimum $0.50

        // Create Stripe checkout session
        const baseUrl = process.env.ADMIN_PORTAL_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
        const successUrl = `${baseUrl}/business/settings.html?payment=success`;
        const cancelUrl = `${baseUrl}/business/settings.html?payment=cancelled`;

        // Create or get Stripe customer
        let stripeCustomerId = customer.stripe_customer_id;
        if (!stripeCustomerId) {
            const stripeCustomer = await stripe.customers.create({
                email: customer.email,
                name: customer.name || customer.company_name,
                metadata: {
                    customer_id: customer.id
                }
            });
            stripeCustomerId = stripeCustomer.id;

            // Save Stripe customer ID to database
            db.updateCustomer(customer.id, {
                stripe_customer_id: stripeCustomerId
            });
        }

        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            mode: 'setup', // Setup mode for saving payment method
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                customer_id: customer.id,
                billing_month: billingMonth,
                usage_type: 'pay_as_you_go'
            }
        });

        res.json({
            success: true,
            checkout_session_id: session.id,
            checkout_url: session.url,
            amount: totalAmount
        });
    } catch (error) {
        console.error('❌ Create checkout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create checkout session',
            message: error.message
        });
    }
});

/**
 * POST /api/customer/billing/portal
 * Create Stripe Customer Portal session for managing payment methods
 */
router.post('/portal', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Please sign in.'
            });
        }

        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Stripe not configured'
            });
        }

        let stripeCustomerId = customer.stripe_customer_id;
        if (!stripeCustomerId) {
            const stripeCustomer = await stripe.customers.create({
                email: customer.email,
                name: customer.name || customer.company_name,
                metadata: { customer_id: customer.id }
            });
            stripeCustomerId = stripeCustomer.id;
            db.updateCustomer(customer.id, { stripe_customer_id: stripeCustomerId });
        }

        const baseUrl = process.env.ADMIN_PORTAL_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
        const returnUrl = `${baseUrl}/business/settings.html`;

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: returnUrl
        });

        res.json({
            success: true,
            url: portalSession.url
        });
    } catch (error) {
        console.error('❌ Create portal session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create billing portal session',
            message: error.message
        });
    }
});

/**
 * GET /api/customer/billing/invoices
 * Get all invoices for customer
 */
router.get('/invoices', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        const invoices = db.getCustomerInvoices(customer.id);

        res.json({
            success: true,
            invoices: invoices || [],
            total: invoices?.length || 0
        });
    } catch (error) {
        console.error('❌ Get invoices error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get invoices',
            message: error.message
        });
    }
});

/**
 * POST /api/customer/billing/payment-method
 * Update payment method (after Stripe checkout)
 */
router.post('/payment-method', authLimiter, async (req, res) => {
    try {
        const customer = getCustomerFromSession(req);
        if (!customer) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
        }

        const { payment_method_id } = req.body;
        if (!payment_method_id) {
            return res.status(400).json({
                success: false,
                error: 'Payment method ID is required'
            });
        }

        // Get payment method details from Stripe
        const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);

        // Attach to customer if not already attached
        if (!paymentMethod.customer) {
            await stripe.paymentMethods.attach(payment_method_id, {
                customer: customer.stripe_customer_id || null
            });
        }

        // Update customer record
        db.updateCustomer(customer.id, {
            stripe_payment_method_id: payment_method_id,
            card_last4: paymentMethod.card?.last4 || null,
            card_brand: paymentMethod.card?.brand || null,
            card_verified: 1
        });

        res.json({
            success: true,
            message: 'Payment method updated successfully',
            payment_method: {
                id: payment_method_id,
                last4: paymentMethod.card?.last4,
                brand: paymentMethod.card?.brand
            }
        });
    } catch (error) {
        console.error('❌ Update payment method error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update payment method',
            message: error.message
        });
    }
});

module.exports = router;

