/**
 * PAYMENT ROUTES
 * Serve payment page and handle Stripe payment processing
 */

const express = require('express');
const path = require('path');
const PaymentService = require('../services/payment-service');

const router = express.Router();

// Note: Stripe integration would go here in production
// For now, we'll simulate payment processing

/**
 * Serve payment page
 * GET /payment/:token
 */
router.get('/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/payment/index.html'));
});

/**
 * Get checkout details by token
 * GET /api/payment/checkout/:token
 */
router.get('/checkout/:token', (req, res) => {
    try {
        const { token } = req.params;
        const result = PaymentService.getCheckoutByToken(token);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json({
            success: true,
            checkout: result.checkout,
            stripe_publishable_key: PaymentService.getStripePublishableKey()
        });

    } catch (error) {
        console.error('Error fetching checkout:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Process payment with Stripe
 * POST /api/payment/process
 * 
 * In production, this would:
 * 1. Create Stripe Payment Intent
 * 2. Process payment
 * 3. Handle webhooks
 * 
 * For demo, we'll simulate successful payment
 */
router.post('/process', async (req, res) => {
    try {
        const { payment_token, payment_method_id, amount, currency, idempotency_key } = req.body;
        const idemKey = idempotency_key || req.headers['idempotency-key'] || `payment_${payment_token}`;

        const db = require('../database');

        // Validate token
        const checkoutResult = PaymentService.getCheckoutByToken(payment_token);
        if (!checkoutResult.success) {
            return res.status(400).json(checkoutResult);
        }
        const claimOpType = 'payment_process';
        const cached = db.getIdempotentResult && db.getIdempotentResult(idemKey, claimOpType);
        if (cached) {
            return res.json({ ...cached.result, idempotent: true });
        }
        const reserve = db.reserveIdempotencyKey && db.reserveIdempotencyKey(idemKey, claimOpType);
        if (reserve === 'in_progress') {
            return res.status(409).json({ success: false, error: 'Payment in progress', idempotent: true });
        }
        if (reserve === 'completed') {
            const c2 = db.getIdempotentResult(idemKey, claimOpType);
            if (c2) return res.json({ ...c2.result, idempotent: true });
        }

        // SECURITY: Validate amount matches checkout amount (prevent tampering)
        const checkoutAmount = parseFloat(checkoutResult.checkout.amount);
        const requestAmount = parseFloat(amount);
        const amountDifference = Math.abs(checkoutAmount - requestAmount);
        
        // Allow small floating point differences (0.01)
        if (amountDifference > 0.01) {
            console.error('❌ Amount mismatch:', {
                checkout_amount: checkoutAmount,
                request_amount: requestAmount,
                difference: amountDifference
            });
            if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
            return res.status(400).json({
                success: false,
                error: 'Amount mismatch. Payment amount does not match checkout amount.'
            });
        }

        // Process payment with Stripe
        console.log('\n💳 PROCESSING STRIPE PAYMENT');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Payment Method ID:', payment_method_id);
        console.log('Amount:', checkoutAmount, currency);
        console.log('Checkout:', checkoutResult.checkout.id);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        let stripe;
        try {
            stripe = require('stripe')(PaymentService.getStripeSecretKey());
        } catch (error) {
            console.error('❌ Stripe not available:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
            });
        }

        try {
            // Create and confirm Stripe Payment Intent
            // Use checkout amount (already validated) and convert to cents
            const amountInCents = Math.round(checkoutAmount * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents, // Convert dollars to cents
                currency: currency || 'usd',
                payment_method: payment_method_id,
                confirm: true,
                return_url: `${process.env.BASE_URL || 'http://localhost:4000'}/payment/success`,
                metadata: {
                    checkout_id: checkoutResult.checkout.id,
                    payment_token: payment_token,
                    customer_email: checkoutResult.checkout.customer_email || '',
                    customer_phone: checkoutResult.checkout.customer_phone || ''
                }
            });

            console.log('✅ Stripe Payment Intent created:', paymentIntent.id);
            console.log('   Status:', paymentIntent.status);

            // Handle 3D Secure or other actions required
            if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_source_action') {
                console.log('⚠️  Payment requires additional action (3D Secure)');
                const result = {
                    success: true,
                    requires_action: true,
                    client_secret: paymentIntent.client_secret,
                    payment_intent_id: paymentIntent.id
                };
                if (db.completeIdempotentResult) db.completeIdempotentResult(idemKey, claimOpType, result);
                return res.json(result);
            }

            // Payment succeeded or is processing
            if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
                // Process payment in our system
                const processResult = await PaymentService.processPayment(
                    payment_token,
                    paymentIntent.id
                );

                if (!processResult.success) {
                    console.error('❌ Failed to process payment in system:', processResult.error);
                    if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
                    return res.status(500).json({
                        success: false,
                        error: processResult.error || 'Failed to process payment'
                    });
                }

                console.log('✅ Payment processed successfully');
                const result = {
                    success: true,
                    payment_intent_id: paymentIntent.id,
                    status: paymentIntent.status,
                    checkout_id: processResult.checkout_id
                };
                if (db.completeIdempotentResult) db.completeIdempotentResult(idemKey, claimOpType, result);
                return res.json(result);
            }

            // Payment failed or was cancelled
            console.error('❌ Payment failed:', paymentIntent.status);
            if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
            return res.status(400).json({
                success: false,
                error: `Payment ${paymentIntent.status}`,
                payment_intent_id: paymentIntent.id
            });

        } catch (stripeError) {
            console.error('❌ Stripe API error:', stripeError.message);
            console.error('   Type:', stripeError.type);
            console.error('   Code:', stripeError.code);
            if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
            return res.status(400).json({
                success: false,
                error: stripeError.message || 'Stripe payment failed',
                stripe_error_type: stripeError.type,
                stripe_error_code: stripeError.code
            });
        }

    } catch (error) {
        console.error('Payment processing error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;