/**
 * CREDITS ROUTES
 * Handles credits purchase, balance checking, and usage tracking
 */

const express = require('express');
const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const rateLimiter = require('../middleware/rate-limiter').authLimiter;

// Initialize Stripe with proper configuration and validation
const stripeConfig = require('../utils/stripe-config');
let stripe = null;
try {
    stripe = stripeConfig.initializeStripe();
} catch (error) {
    if (error.message.includes('SECURITY ERROR')) {
        console.error('❌', error.message);
        console.error('⚠️  Credits purchase endpoints disabled until Stripe keys are fixed.');
        stripe = null;
    } else {
        console.warn('⚠️  Stripe not configured - Payment features will be disabled');
    }
}

const router = express.Router();

// Credit packages (minutes per price)
const CREDIT_PACKAGES = [
    { id: 'starter', name: 'Starter Pack', minutes: 100, price: 5.00, popular: false },
    { id: 'professional', name: 'Professional Pack', minutes: 500, price: 20.00, popular: true },
    { id: 'business', name: 'Business Pack', minutes: 1500, price: 50.00, popular: false },
    { id: 'enterprise', name: 'Enterprise Pack', minutes: 5000, price: 150.00, popular: false }
];

/**
 * GET /api/credits/packages
 * Get available credit packages
 */
router.get('/packages', rateLimiter, (req, res) => {
    res.json({
        success: true,
        packages: CREDIT_PACKAGES
    });
});

/**
 * GET /api/credits/balance
 * Get customer's credit balance
 */
router.get('/balance', rateLimiter, async (req, res) => {
    try {
        const sessionId = req.cookies?.customer_session;
        if (!sessionId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const session = db.getCustomerSession(sessionId);
        if (!session) {
            return res.status(401).json({
                success: false,
                error: 'Invalid session'
            });
        }

        const customer = db.getCustomer(session.customer_id);
        if (!customer || !customer.email_verified) {
            return res.status(400).json({
                success: false,
                error: 'Email not verified'
            });
        }

        // MANDATORY: Check if terms accepted
        const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
        if (!termsAccepted) {
            return res.status(403).json({
                success: false,
                error: 'Terms not accepted',
                message: 'You must accept the terms of service before accessing credits. Please visit /terms to accept.'
            });
        }

        const credits = db.getCustomerCredits(session.customer_id);

        // If no credits record exists, customer has 0 credits
        const balance = credits ? credits.credits_balance_minutes : 0;
        const freeAllocated = credits ? credits.free_credits_allocated : 0;
        const freeUsed = credits ? credits.free_credits_used : 0;
        const paidPurchased = credits ? credits.paid_credits_purchased : 0;
        const paidUsed = credits ? credits.paid_credits_used : 0;

        res.json({
            success: true,
            credits: {
                balance: balance,
                free: {
                    allocated: freeAllocated,
                    used: freeUsed,
                    remaining: freeAllocated - freeUsed
                },
                paid: {
                    purchased: paidPurchased,
                    used: paidUsed,
                    remaining: paidPurchased - paidUsed
                }
            },
            // Also include top-level for backwards compatibility
            balance: balance,
            free: {
                allocated: freeAllocated,
                used: freeUsed,
                remaining: freeAllocated - freeUsed
            },
            paid: {
                purchased: paidPurchased,
                used: paidUsed,
                remaining: paidPurchased - paidUsed
            }
        });
    } catch (error) {
        console.error('❌ Get credits balance error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get credits balance',
            message: error.message
        });
    }
});

/**
 * POST /api/credits/purchase
 * Create Stripe checkout session for credits purchase
 */
router.post('/purchase', rateLimiter, async (req, res) => {
    try {
        const sessionId = req.cookies?.customer_session;
        if (!sessionId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const session = db.getCustomerSession(sessionId);
        if (!session) {
            return res.status(401).json({
                success: false,
                error: 'Invalid session'
            });
        }

        const customer = db.getCustomer(session.customer_id);
        if (!customer || !customer.email_verified) {
            return res.status(400).json({
                success: false,
                error: 'Email not verified'
            });
        }

        // MANDATORY: Check if terms accepted
        const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
        if (!termsAccepted) {
            return res.status(403).json({
                success: false,
                error: 'Terms not accepted',
                message: 'You must accept the terms of service before purchasing credits. Please visit /terms to accept.'
            });
        }

        const { package_id } = req.body;
        if (!package_id) {
            return res.status(400).json({
                success: false,
                error: 'Package ID is required'
            });
        }

        const creditPackage = CREDIT_PACKAGES.find(p => p.id === package_id);
        if (!creditPackage) {
            return res.status(400).json({
                success: false,
                error: 'Invalid package ID'
            });
        }

        if (!stripe) {
            return res.status(500).json({
                success: false,
                error: 'Stripe not configured',
                message: 'Payment processing is not available. Please configure Stripe keys.'
            });
        }

        // Determine success/cancel URLs based on environment
        const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL ||
            (process.env.NODE_ENV === 'production' ? 'https://api.doclittle.site' : `http://localhost:4000`);

        const successUrl = `${baseUrl}/api/credits/purchase/success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${baseUrl}/docs?purchase=cancelled`;

        // Check if customer has stored payment method
        const paymentMethod = db.getCustomerPaymentMethod(customer.id);
        const hasStoredCard = paymentMethod && paymentMethod.card_verified === 1 && paymentMethod.stripe_payment_method_id;

        let checkoutSession;

        if (hasStoredCard) {
            // Use stored payment method - direct charge (one-click checkout)
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: Math.round(creditPackage.price * 100), // Stripe uses cents
                    currency: 'usd',
                    payment_method: paymentMethod.stripe_payment_method_id,
                    confirm: true,
                    description: `${creditPackage.name} - ${creditPackage.minutes} Minutes`,
                    metadata: {
                        customer_id: customer.id,
                        package_id: creditPackage.id,
                        package_name: creditPackage.name,
                        credits_amount: creditPackage.minutes.toString(),
                        amount_paid: creditPackage.price.toString(),
                        type: 'credit_purchase'
                    }
                });

                if (paymentIntent.status === 'succeeded') {
                    // Purchase successful - create purchase record and add credits immediately
                    const purchaseResult = db.createCreditPurchase(
                        customer.id,
                        creditPackage.name,
                        creditPackage.minutes,
                        creditPackage.price,
                        null, // No checkout session for direct purchase
                        paymentMethod.stripe_payment_method_id
                    );

                    // Update purchase status to completed
                    const purchaseId = purchaseResult.lastInsertRowid;
                    const purchase = db.db.prepare('SELECT * FROM credit_purchases WHERE id = ?').get(purchaseId);
                    if (purchase) {
                        db.updateCreditPurchaseStatus(
                            purchase.id,
                            'completed',
                            paymentIntent.id,
                            new Date().toISOString()
                        );
                    }

                    db.addPaidCredits(customer.id, creditPackage.minutes);

                    console.log(`✅ Direct credit purchase completed: ${creditPackage.minutes} minutes for customer ${customer.id}`);

                    return res.json({
                        success: true,
                        direct_purchase: true,
                        credits_added: creditPackage.minutes,
                        message: 'Credits purchased successfully using your stored card'
                    });
                } else if (paymentIntent.status === 'requires_action') {
                    // 3D Secure required - return client secret for frontend handling
                    return res.json({
                        success: false,
                        requires_action: true,
                        client_secret: paymentIntent.client_secret,
                        error: 'Card requires additional authentication'
                    });
                } else {
                    throw new Error(`Payment status: ${paymentIntent.status}`);
                }
            } catch (directError) {
                console.error('❌ Direct purchase failed, falling back to checkout:', directError);
                // Fall through to checkout session creation
            }
        }

        // No stored card OR direct purchase failed - use checkout session
        checkoutSession = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `${creditPackage.name} - ${creditPackage.minutes} Minutes`,
                            description: `Credits for voice agent API calls (${creditPackage.minutes} minutes)`
                        },
                        unit_amount: Math.round(creditPackage.price * 100) // Stripe uses cents
                    },
                    quantity: 1
                }
            ],
            mode: 'payment',
            success_url: successUrl,
            cancel_url: cancelUrl,
            customer_email: customer.email,
            metadata: {
                customer_id: customer.id,
                package_id: creditPackage.id,
                package_name: creditPackage.name,
                credits_amount: creditPackage.minutes,
                amount_paid: creditPackage.price.toString()
            }
        });

        // Create credit purchase record (pending)
        db.createCreditPurchase(
            customer.id,
            creditPackage.name,
            creditPackage.minutes,
            creditPackage.price,
            checkoutSession.id
        );

        res.json({
            success: true,
            checkout_url: checkoutSession.url,
            session_id: checkoutSession.id
        });
    } catch (error) {
        console.error('❌ Create purchase error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create purchase',
            message: error.message
        });
    }
});

/**
 * GET /api/credits/purchase/success
 * Handle successful Stripe checkout (webhook callback)
 */
router.get('/purchase/success', rateLimiter, async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) {
            return res.redirect('/docs?purchase=error');
        }

        if (!stripe) {
            return res.redirect('/docs?purchase=error&reason=stripe_not_configured');
        }

        // Retrieve checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status !== 'paid') {
            return res.redirect('/docs?purchase=error');
        }

        // Find purchase record
        const purchase = db.getCreditPurchaseByCheckoutSession(session_id);
        if (!purchase) {
            return res.redirect('/docs?purchase=error');
        }

        // Update purchase status
        db.updateCreditPurchaseStatus(
            purchase.id,
            'completed',
            session.payment_intent,
            new Date().toISOString()
        );

        // Add credits to customer account
        db.addPaidCredits(purchase.customer_id, purchase.credits_amount);

        console.log(`✅ Credits purchase completed: ${purchase.credits_amount} minutes for customer ${purchase.customer_id}`);

        // Redirect to docs with success message
        res.redirect('/docs?purchase=success&credits=' + purchase.credits_amount);
    } catch (error) {
        console.error('❌ Purchase success handler error:', error);
        res.redirect('/docs?purchase=error');
    }
});

/**
 * GET /api/credits/usage
 * Get customer's usage history
 */
router.get('/usage', rateLimiter, async (req, res) => {
    try {
        const sessionId = req.cookies?.customer_session;
        if (!sessionId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const session = db.getCustomerSession(sessionId);
        if (!session) {
            return res.status(401).json({
                success: false,
                error: 'Invalid session'
            });
        }

        const customer = db.getCustomer(session.customer_id);
        if (!customer || !customer.email_verified) {
            return res.status(400).json({
                success: false,
                error: 'Email not verified'
            });
        }

        // MANDATORY: Check if terms accepted
        const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
        if (!termsAccepted) {
            return res.status(403).json({
                success: false,
                error: 'Terms not accepted',
                message: 'You must accept the terms of service before accessing usage history. Please visit /terms to accept.'
            });
        }

        // Get voice call logs for customer
        const calls = db.db.prepare(`
      SELECT * FROM voice_call_log 
      WHERE customer_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(session.customer_id);

        res.json({
            success: true,
            calls: calls.map(call => ({
                id: call.id,
                call_id: call.call_id,
                twilio_call_sid: call.twilio_call_sid,
                duration_seconds: call.call_duration_seconds,
                duration_minutes: call.call_duration_minutes,
                credits_deducted: call.credits_deducted,
                twilio_cost_usd: call.twilio_cost_usd,
                retell_cost_usd: call.retell_cost_usd,
                total_cost_usd: call.total_cost_usd,
                cost_source: call.cost_source,
                cost_updated_at: call.cost_updated_at,
                status: call.status,
                created_at: call.created_at
            }))
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
 * GET /api/credits/costs
 * Get total costs for customer (with optional date range)
 */
router.get('/costs', rateLimiter, (req, res) => {
    try {
        const sessionId = req.cookies?.customer_session;
        if (!sessionId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const session = db.getCustomerSession(sessionId);
        if (!session) {
            return res.status(401).json({
                success: false,
                error: 'Invalid session'
            });
        }

        const customer = db.getCustomer(session.customer_id);
        if (!customer || !customer.email_verified) {
            return res.status(400).json({
                success: false,
                error: 'Email not verified'
            });
        }

        // MANDATORY: Check if terms accepted
        const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
        if (!termsAccepted) {
            return res.status(403).json({
                success: false,
                error: 'Terms not accepted',
                message: 'You must accept the terms of service before viewing costs. Please visit /terms to accept.'
            });
        }

        // Get date range from query params (optional)
        const startDate = req.query.start_date || null;
        const endDate = req.query.end_date || null;

        // Get total costs
        const costSummary = db.getCustomerTotalCosts(session.customer_id, startDate, endDate);

        // Get detailed cost breakdown
        const costDetails = db.getVoiceCallCostsByCustomer(session.customer_id, startDate, endDate);

        res.json({
            success: true,
            summary: {
                total_calls: costSummary?.total_calls || 0,
                total_minutes: costSummary?.total_minutes || 0,
                total_twilio_cost: costSummary?.total_twilio_cost || 0,
                total_retell_cost: costSummary?.total_retell_cost || 0,
                total_cost: costSummary?.total_cost || 0
            },
            calls: costDetails,
            date_range: {
                start_date: startDate || 'all_time',
                end_date: endDate || 'all_time'
            }
        });
    } catch (error) {
        console.error('❌ Get costs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get costs',
            message: error.message
        });
    }
});

/**
 * POST /api/credits/webhook
 * Stripe webhook handler for payment events (optional - for real-time updates)
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.warn('⚠️  Stripe webhook secret not configured');
        return res.status(400).send('Webhook secret not configured');
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('❌ Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // Find purchase record
        const purchase = db.getCreditPurchaseByCheckoutSession(session.id);
        if (purchase && purchase.status === 'pending') {
            // Update purchase status
            db.updateCreditPurchaseStatus(
                purchase.id,
                'completed',
                session.payment_intent,
                new Date().toISOString()
            );

            // Add credits to customer account
            db.addPaidCredits(purchase.customer_id, purchase.credits_amount);

            console.log(`✅ Webhook: Credits purchase completed: ${purchase.credits_amount} minutes for customer ${purchase.customer_id}`);
        }
    }

    res.json({ received: true });
});

module.exports = router;

