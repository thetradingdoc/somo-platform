/**
 * PAYMENT ROUTES
 * Serve payment page and handle Stripe payment processing
 */

const express = require('express');
const path = require('path');
const PaymentService = require('../services/payment-service');
const db = require('../database');

const router = express.Router();

// Note: Stripe integration would go here in production
// For now, we'll simulate payment processing

/**
 * Task 32, 33: Payment success page (Stripe 3DS redirect target)
 * Serves success.html with appointment context and links to appointments
 */
router.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/payment/success.html'));
});

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
router.get('/checkout/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const result = PaymentService.getCheckoutByToken(token);

        if (!result.success) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_checkout_failed'); } catch (_) {}
            return res.status(400).json(result);
        }

        let checkout = result.checkout;
        const requires_verification = result.requires_verification;
        const identity_verified = result.identity_verified;
        if (checkout.appointment_id) {
            const db = require('../database');
            const appt = db.getAppointment ? await db.getAppointment(checkout.appointment_id) : null;
            if (appt) {
                checkout = { ...checkout, appointment_date: appt.date, appointment_time: appt.time, appointment_type: appt.appointment_type || checkout.product_name };
            }
        }

        res.json({
            success: true,
            checkout,
            requires_verification: !!requires_verification,
            identity_verified: !!identity_verified,
            stripe_publishable_key: PaymentService.getStripePublishableKey()
        });

    } catch (error) {
        try { db.incrementOpsCounter && db.incrementOpsCounter('payment_checkout_error'); } catch (_) {}
        console.error('Error fetching checkout:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Task 53: Verify 6-digit code before payment (web payment page)
 * POST /api/payment/verify-code
 */
router.post('/verify-code', async (req, res) => {
  try {
    const { payment_token, verification_code } = req.body;
    const token = payment_token || req.body.token;
    const code = verification_code || req.body.code;

    if (!token || !code) {
      return res.status(400).json({ success: false, error: 'payment_token and verification_code are required' });
    }

    const db = require('../database');
    const tokenRecord = db.getPaymentToken(token);
    if (!tokenRecord) {
      return res.status(404).json({ success: false, error: 'Invalid payment link' });
    }

    if (tokenRecord.verification_code_expires) {
      const exp = new Date(tokenRecord.verification_code_expires);
      if (new Date() > exp) {
        return res.status(400).json({ success: false, error: 'Verification code expired' });
      }
    }

    if ((tokenRecord.verification_code || '').trim() !== String(code).trim()) {
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }

    db.updatePaymentToken(token, { status: 'verified', identity_verified_at: new Date().toISOString() });

    res.json({ success: true, message: 'Identity verified. You can now complete payment.' });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get available payment methods (4.1)
 * GET /api/payment/methods
 * Query: merchant_id (optional)
 */
router.get('/methods', (req, res) => {
  try {
    const PaymentMethodConfig = require('../services/payment-method-config');
    const merchantId = req.query.merchant_id || null;
    const { methods, details } = PaymentMethodConfig.getAvailablePaymentMethods(merchantId);
    res.json({ success: true, payment_methods: methods, details });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Create Stripe Payment Intent only (Direct Stripe - no confirmation).
 * Returns client_secret for client-side Stripe.js confirmation.
 * POST /api/payment/create-intent
 */
router.post('/create-intent', async (req, res) => {
  try {
    const { checkout_id, amount, merchant_id } = req.body;
    if (!checkout_id) {
      return res.status(400).json({ success: false, error: 'checkout_id is required' });
    }
    const PaymentOrchestrator = require('../services/payment-orchestrator');
    const result = await PaymentOrchestrator.createStripePaymentIntent(checkout_id, amount, merchant_id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('Create intent error:', error);
    res.status(500).json({ success: false, error: error.message });
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
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(400).json(checkoutResult);
        }
        // Enforce payment ↔ appointment linking for telehealth portal (mvp-51)
        // Patient portal checkouts must be tied to an appointment_id.
        if (!checkoutResult.checkout.appointment_id) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(400).json({
                success: false,
                error: 'Invalid checkout: appointment_id is required for patient payments.'
            });
        }
        // Task 53: Reject payment until identity verified
        if (checkoutResult.requires_verification && !checkoutResult.identity_verified) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(403).json({
                success: false,
                error: 'Identity verification required. Enter the 6-digit code from your email to continue.',
                requires_verification: true
            });
        }
        const claimOpType = 'payment_process';
        const cached = db.getIdempotentResult && db.getIdempotentResult(idemKey, claimOpType);
        if (cached) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_success'); } catch (_) {}
            return res.json({ ...cached.result, idempotent: true });
        }
        const reserve = db.reserveIdempotencyKey && db.reserveIdempotencyKey(idemKey, claimOpType);
        if (reserve === 'in_progress') {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(409).json({ success: false, error: 'Payment in progress', idempotent: true });
        }
        if (reserve === 'completed') {
            const c2 = db.getIdempotentResult(idemKey, claimOpType);
            if (c2) return res.json({ ...c2.result, idempotent: true });
        }

        // Task 28: Amount revalidation - always use server-side checkout amount, never client
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
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
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
            const { withRetry } = require('../utils/retry');
            const amountInCents = Math.round(checkoutAmount * 100);
            const paymentIntent = await withRetry(() => stripe.paymentIntents.create({
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
            }), { maxAttempts: 3 });

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

                // Task 11, 12, 15, 16: Financial audit, ledger, receipt (unified with /process-payment)
                const PaymentProcessorService = require('../services/payment-processor-service');
                try {
                  await PaymentProcessorService.completePaymentSuccess({
                    checkout: checkoutResult.checkout,
                    amount: checkoutAmount,
                    paymentMethod: 'stripe',
                    paymentIntentId: paymentIntent.id
                  });
                } catch (e) {
                  console.warn('⚠️  completePaymentSuccess failed:', e.message);
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

/**
 * Task 18: Cancel payment token (invalidates link before use)
 * POST /api/payment/token/cancel
 * Body: { payment_token }
 */
router.post('/token/cancel', (req, res) => {
  try {
    const { payment_token } = req.body;
    if (!payment_token) {
      return res.status(400).json({ success: false, error: 'payment_token is required' });
    }
    const db = require('../database');
    const result = db.cancelPaymentToken ? db.cancelPaymentToken(payment_token) : { success: false, error: 'Not supported' };
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json({ success: true, message: 'Payment link cancelled' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Task 15: Capture authorized Payment Intent (e.g. when visit session starts)
 * POST /api/payment/capture
 * Body: { payment_intent_id }
 */
router.post('/capture', async (req, res) => {
  try {
    const { payment_intent_id } = req.body;
    if (!payment_intent_id) {
      return res.status(400).json({ success: false, error: 'payment_intent_id is required' });
    }
    const stripeConfig = require('../utils/stripe-config');
    let stripe;
    try {
      stripe = stripeConfig.initializeStripe();
    } catch (_) {
      return res.status(503).json({ success: false, error: 'Stripe not configured' });
    }
    const pi = await stripe.paymentIntents.capture(payment_intent_id);
    res.json({
      success: true,
      payment_intent_id: pi.id,
      status: pi.status
    });
  } catch (error) {
    console.error('Capture error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      stripe_error_type: error.type,
      stripe_error_code: error.code
    });
  }
});

/**
 * Task 17/22: Refund API for cancellations, no-shows, overcharges, partial refunds
 * POST /api/payment/refund
 * Body: { checkout_id?, payment_intent_id?, amount?, reason }
 */
router.post('/refund', async (req, res) => {
  try {
    const { checkout_id, payment_intent_id, amount, reason = 'refund' } = req.body;
    const db = require('../database');

    let checkout = null;
    let piId = payment_intent_id;

    if (checkout_id) {
      checkout = await db.getVoiceCheckout(checkout_id);
      if (!checkout) {
        return res.status(404).json({ success: false, error: 'Checkout not found' });
      }
      piId = piId || checkout.payment_intent_id;
    }
    if (!piId) {
      return res.status(400).json({ success: false, error: 'payment_intent_id or checkout_id with completed payment required' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const refundCents = amount != null ? Math.round(parseFloat(amount) * 100) : undefined;
    const refundOpts = {
      payment_intent: piId,
      reason: ['requested_by_customer', 'duplicate', 'fraudulent'].includes(reason) ? reason : 'requested_by_customer'
    };
    if (refundCents != null && refundCents > 0) refundOpts.amount = refundCents;

    const refund = await stripe.refunds.create(refundOpts);
    const amtRefunded = (refund.amount || 0) / 100;

    if (checkout) {
      try {
        const PaymentProcessorService = require('../services/payment-processor-service');
        await PaymentProcessorService.recordRefundEvent({ checkout, amount: amtRefunded, refundId: refund.id });
      } catch (e) {
        console.warn('Record refund event failed:', e.message);
      }
    }

    res.json({
      success: true,
      refund_id: refund.id,
      amount_refunded: amtRefunded,
      status: refund.status
    });
  } catch (error) {
    console.error('Refund error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      stripe_error_code: error.code
    });
  }
});

/**
 * Task 15: Cancel authorized Payment Intent (e.g. no-show – release hold)
 * POST /api/payment/cancel
 * Body: { payment_intent_id }
 */
router.post('/cancel', async (req, res) => {
  try {
    const { payment_intent_id } = req.body;
    if (!payment_intent_id) {
      return res.status(400).json({ success: false, error: 'payment_intent_id is required' });
    }
    const stripeConfig = require('../utils/stripe-config');
    let stripe;
    try {
      stripe = stripeConfig.initializeStripe();
    } catch (_) {
      return res.status(503).json({ success: false, error: 'Stripe not configured' });
    }
    const pi = await stripe.paymentIntents.cancel(payment_intent_id);
    res.json({
      success: true,
      payment_intent_id: pi.id,
      status: pi.status
    });
  } catch (error) {
    console.error('Cancel error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      stripe_error_type: error.type,
      stripe_error_code: error.code
    });
  }
});

/**
 * Task 44: Circle payment status polling
 * POST /api/payment/circle/poll-status
 * Polls Circle API for pending transfers and updates DB.
 */
router.post('/circle/poll-status', async (req, res) => {
  try {
    const db = require('../database');
    const CircleService = require('../services/circle-service');
    const pending = db.getCircleTransfersPending ? db.getCircleTransfersPending(20) : [];
    const results = { updated: 0, failed: 0 };
    for (const t of pending) {
      const circleId = t.circle_transfer_id;
      if (!circleId) continue;
      try {
        const statusResult = CircleService.getTransferStatus ? await CircleService.getTransferStatus(circleId) : null;
        if (!statusResult || !statusResult.success) continue;
        const status = (statusResult.status || '').toLowerCase();
        if (status === 'complete' || status === 'completed' || status === 'settled') {
          db.updateCircleTransfer(t.id, { status: 'completed', completed_at: new Date().toISOString() });
          results.updated++;
        } else if (status === 'failed') {
          db.updateCircleTransfer(t.id, { status: 'failed', error_message: 'Polled: transfer failed' });
          results.updated++;
        }
      } catch (_) {
        results.failed++;
      }
    }
    res.json({ success: true, ...results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;