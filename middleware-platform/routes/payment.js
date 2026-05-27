/**
 * PAYMENT ROUTES
 * Serve payment page and handle Stripe payment processing
 */

const express = require('express');
const path = require('path');
const PaymentService = require('../services/payment-service');
const db = require('../database');
const {
  resolveProviderId,
  enrichVoiceCheckout,
  withCommercePaymentPayload,
  withProviderAliases,
  withPrescriptionAliases,
  logAliasUsage
} = require('../utils/naming-aliases');

const router = express.Router();
const { evaluateAndRecord, enqueueFraudReview } = require('../services/anti-sybil-service');

// Note: Stripe integration would go here in production
// For now, we'll simulate payment processing

function resolveIdempotencyKey(req, fallbackSeed) {
  const headerKey = (req.headers['idempotency-key'] || '').toString().trim();
  if (headerKey) return headerKey;
  const bodyKey = (req.body?.idempotency_key || '').toString().trim();
  if (bodyKey) return bodyKey;
  if (!fallbackSeed) return '';
  return `auto:${fallbackSeed}`;
}

function withPaymentIdempotency(operationType, fallbackFromReq) {
  return (req, res, next) => {
    const key = resolveIdempotencyKey(req, fallbackFromReq ? fallbackFromReq(req) : '');
    if (!key) return next();

    const cached = db.getIdempotentResult && db.getIdempotentResult(key, operationType);
    if (cached && cached.result) {
      return res.json({ ...cached.result, idempotent: true });
    }
    const reservation = db.reserveIdempotencyKey && db.reserveIdempotencyKey(key, operationType);
    if (reservation === 'in_progress') {
      return res.status(409).json({ success: false, error: 'Request already in progress for this Idempotency-Key' });
    }
    if (reservation === 'completed') {
      const c2 = db.getIdempotentResult && db.getIdempotentResult(key, operationType);
      if (c2 && c2.result) return res.json({ ...c2.result, idempotent: true });
    }

    req.idempotencyKey = key;
    req.idempotencyOperation = operationType;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        if (key && body && body.success && db.completeIdempotentResult) {
          db.completeIdempotentResult(key, operationType, body);
        }
      } catch (_) {}
      return originalJson(body);
    };
    res.on('finish', () => {
      if (key && res.statusCode >= 400 && db.releaseIdempotencyKey) {
        try { db.releaseIdempotencyKey(key, operationType); } catch (_) {}
      }
    });
    return next();
  };
}

function rejectDuplicatePaymentAttempt(checkout) {
  if (!checkout || !checkout.id || !db.getVoiceCheckout) return null;
  try {
    const row = db.getVoiceCheckout(checkout.id);
    if (!row) return null;
    const paid = String(row.status || '').toLowerCase() === 'completed' || !!row.payment_intent_id;
    if (!paid) return null;
    return {
      success: false,
      error: 'Duplicate payment attempt blocked',
      error_code: 'DUPLICATE_PAYMENT_ATTEMPT',
      checkout_id: row.id,
      payment_intent_id: row.payment_intent_id || null
    };
  } catch (_) {
    return null;
  }
}

/**
 * Task 32, 33: Payment success page (Stripe 3DS redirect target)
 * Serves success.html with appointment context and links to appointments
 */
router.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/payment/success.html'));
});

/**
 * After Stripe 3DS redirect: return non-sensitive PaymentIntent metadata for resume links (kelly_session_id).
 * GET /api/payment/intent-metadata?payment_intent=pi_...&payment_intent_client_secret=...
 */
router.get('/intent-metadata', async (req, res) => {
  const piId = req.query.payment_intent;
  const clientSecret = req.query.payment_intent_client_secret;
  if (!piId || !clientSecret) {
    return res.status(400).json({
      success: false,
      error: 'payment_intent and payment_intent_client_secret are required'
    });
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return res.status(503).json({ success: false, error: 'stripe_not_configured' });
  }
  try {
    const stripe = require('stripe')(stripeSecret);
    const pi = await stripe.paymentIntents.retrieve(String(piId));
    if (!pi || pi.client_secret !== String(clientSecret)) {
      return res.status(403).json({ success: false, error: 'invalid_intent' });
    }
    const m = pi.metadata || {};
    return res.json({
      success: true,
      kelly_session_id: m.kelly_session_id || null,
      checkout_id: m.checkout_id || null,
      commerce_quote_id: m.commerce_quote_id || null
    });
  } catch (e) {
    console.error('[Payment] intent-metadata error:', e.message);
    return res.status(500).json({ success: false, error: 'retrieve_failed' });
  }
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
        const result = await PaymentService.getCheckoutByToken(token);

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

        checkout = enrichVoiceCheckout(checkout);

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
router.post(
  '/create-intent',
  withPaymentIdempotency('payment_create_intent', (req) => `create_intent:${req.body?.checkout_id || req.body?.prescription_checkout_id || ''}`),
  async (req, res) => {
  try {
    logAliasUsage('payment-create-intent', req);
    const body = req.body || {};
    const checkout_id = body.checkout_id || body.prescription_checkout_id;
    const amount = body.amount;
    const merchant_id = resolveProviderId(body) || body.merchant_id;
    if (!checkout_id) {
      return res.status(400).json({ success: false, error: 'checkout_id (or prescription_checkout_id) is required' });
    }
    const PaymentOrchestrator = require('../services/payment-orchestrator');
    const result = await PaymentOrchestrator.createStripePaymentIntent(checkout_id, amount, merchant_id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    const checkoutRow = await db.getVoiceCheckout(checkout_id);
    res.json(withPrescriptionAliases(withProviderAliases(result, checkoutRow?.merchant_id), checkoutRow?.product_id));
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
router.post('/process', withPaymentIdempotency('payment_process', (req) => `payment:${req.body?.payment_token || ''}`), async (req, res) => {
    try {
        const { payment_token, payment_method_id, amount, currency, idempotency_key } = req.body;
        const idemKey = req.idempotencyKey || idempotency_key || req.headers['idempotency-key'] || `payment_${payment_token}`;

        // #region agent log
        fetch('http://127.0.0.1:7543/ingest/a415f78f-06bc-471d-9251-324ff2e64d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ae50e'},body:JSON.stringify({sessionId:'4ae50e',runId:'pre-fix',hypothesisId:'H5',location:'routes/payment.js:POST_/api/payment/process:entry',message:'Stripe payment process request',data:{hasToken:!!payment_token,hasPaymentMethod:!!payment_method_id,amount:Number(amount||0),currency:String(currency||'usd'),hasIdempotencyKey:!!idemKey},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        const db = require('../database');

        // Validate token
        const checkoutResult = await PaymentService.getCheckoutByToken(payment_token);
        if (!checkoutResult.success) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(400).json(checkoutResult);
        }

        const checkout = checkoutResult.checkout;

        // Telehealth checkouts require appointment_id (mvp-51). Commerce (retail) checkouts
        // have product_id / merchant_id and no appointment — allow through to Stripe.
        const isCommerceCheckout =
            !checkout.appointment_id && !!(checkout.product_id || checkout.merchant_id);

        if (!isCommerceCheckout && !checkout.appointment_id) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(400).json({
                success: false,
                error: 'Invalid checkout: appointment_id is required for patient payments.'
            });
        }

        // Task 53: identity verification — telehealth only (commerce skips email code gate)
        if (!isCommerceCheckout && checkoutResult.requires_verification && !checkoutResult.identity_verified) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(403).json({
                success: false,
                error: 'Identity verification required. Enter the 6-digit code from your email to continue.',
                requires_verification: true
            });
        }
        const claimOpType = 'payment_process';

        const duplicateGuard = rejectDuplicatePaymentAttempt(checkout);
        if (duplicateGuard) {
            try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
            return res.status(409).json(duplicateGuard);
        }

        const antiSybil = evaluateAndRecord({
          scope: 'payment_process',
          identityKey: checkout.customer_email || checkout.customer_phone || payment_token,
          ip: req.ip || req.headers['x-forwarded-for'] || '',
          userAgent: req.headers['user-agent'] || '',
          amountCents: Math.round((parseFloat(checkout.amount || amount || 0) || 0) * 100)
        });
        if (antiSybil.decision === 'block') {
          let review = null;
          try {
            review = enqueueFraudReview({
              antiSybilEventId: antiSybil.eventId,
              scope: 'payment_process',
              priority: antiSybil.score >= 85 ? 'critical' : 'high',
              slaMinutes: antiSybil.score >= 85 ? 30 : 120
            });
          } catch (_) {}
          try { db.incrementOpsCounter && db.incrementOpsCounter('payment_process_failed'); } catch (_) {}
          return res.status(429).json({
            success: false,
            error: 'Payment attempt blocked for risk review',
            error_code: 'ANTI_SYBIL_BLOCKED',
            risk_score: antiSybil.score,
            fraud_review_id: review?.id || null
          });
        }

        // Task 28: Amount revalidation - always use server-side checkout amount, never client
        const checkoutAmount = parseFloat(checkout.amount);
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
        console.log('Checkout:', checkout.id);
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
            const baseUrl = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
            const piMetadata = {
                checkout_id: checkout.id,
                payment_token: payment_token,
                customer_email: checkout.customer_email || '',
                customer_phone: checkout.customer_phone || ''
            };
            if (checkout.commerce_quote_id) {
                piMetadata.commerce_quote_id = String(checkout.commerce_quote_id);
            }
            if (checkout.merchant_id) {
                piMetadata.merchant_id = String(checkout.merchant_id);
            }

            const paymentIntent = await withRetry(() => stripe.paymentIntents.create({
                amount: amountInCents, // Convert dollars to cents
                currency: currency || 'usd',
                payment_method: payment_method_id,
                confirm: true,
                return_url: `${baseUrl}/api/payment/success`,
                metadata: piMetadata
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
                return res.json(withCommercePaymentPayload(result, checkout));
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
                    checkout,
                    amount: checkoutAmount,
                    paymentMethod: 'stripe',
                    paymentIntentId: paymentIntent.id
                  });
                } catch (e) {
                  console.warn('⚠️  completePaymentSuccess failed:', e.message);
                }

                // Commerce: create merchant_orders synchronously (idempotent); webhook also runs this path.
                if (isCommerceCheckout && paymentIntent.status === 'succeeded') {
                  try {
                    const { ensureMerchantOrderFromVoiceCheckout } = require('../services/ensure-merchant-order-from-voice-checkout');
                    const voiceCheckout = await db.getVoiceCheckout(checkout.id);
                    if (voiceCheckout) {
                      await ensureMerchantOrderFromVoiceCheckout(paymentIntent, voiceCheckout, { source: 'process_route' });
                    }
                  } catch (orderErr) {
                    console.warn('[Payment] Sync merchant order creation failed (non-fatal):', orderErr.message);
                  }
                }

                console.log('✅ Payment processed successfully');
                const result = {
                    success: true,
                    payment_intent_id: paymentIntent.id,
                    status: paymentIntent.status,
                    checkout_id: processResult.checkout_id
                };
                if (db.completeIdempotentResult) db.completeIdempotentResult(idemKey, claimOpType, result);
                return res.json(withCommercePaymentPayload(result, checkout));
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
router.post('/capture', withPaymentIdempotency('payment_capture', (req) => `capture:${req.body?.payment_intent_id || ''}`), async (req, res) => {
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
router.post('/refund', withPaymentIdempotency('payment_refund', (req) => `refund:${req.body?.payment_intent_id || req.body?.checkout_id || ''}:${req.body?.amount || 'full'}`), async (req, res) => {
  try {
    logAliasUsage('payment-refund', req);
    const { payment_intent_id, amount, reason = 'refund' } = req.body;
    const checkout_id = req.body.checkout_id || req.body.prescription_checkout_id;
    const db = require('../database');
    const RefundWorkflowService = require('../services/refund-workflow-service');

    let checkout = null;
    let piId = payment_intent_id;

    if (checkout_id) {
      checkout = await db.getVoiceCheckout(checkout_id);
      if (!checkout) {
        return res.status(404).json({ success: false, error: 'Checkout not found' });
      }
      piId = piId || checkout.payment_intent_id;
    }
    if (!checkout && piId) {
      checkout = await db.getVoiceCheckoutByPaymentIntentId(piId);
    }
    if (!piId && checkout) {
      piId = checkout.payment_intent_id;
    }
    if (!piId) {
      return res.status(400).json({ success: false, error: 'payment_intent_id or checkout_id with completed payment required' });
    }

    const stripeReason = ['requested_by_customer', 'duplicate', 'fraudulent'].includes(reason) ? reason : 'requested_by_customer';

    if (checkout) {
      const result = await RefundWorkflowService.executeRefundWorkflow({
        checkout,
        amount: amount != null && amount !== '' ? parseFloat(amount) : null,
        reason: stripeReason,
        actor_type: 'api',
        actor_id: null
      });
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Refund failed',
          workflow_id: result.workflow_id,
          eligibility: result.eligibility || null,
          stripe_error_code: result.stripe_error_code
        });
      }
      return res.json({
        success: true,
        workflow_id: result.workflow_id,
        refund_id: result.refund_id,
        amount_refunded: result.amount_refunded,
        status: 'succeeded'
      });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const refundCents = amount != null ? Math.round(parseFloat(amount) * 100) : undefined;
    const refundOpts = {
      payment_intent: piId,
      reason: stripeReason
    };
    if (refundCents != null && refundCents > 0) refundOpts.amount = refundCents;

    const refund = await stripe.refunds.create(refundOpts);
    const amtRefunded = (refund.amount || 0) / 100;

    res.json({
      success: true,
      refund_id: refund.id,
      amount_refunded: amtRefunded,
      status: refund.status,
      note: 'No voice_checkout row matched; refund executed without workflow audit linkage.'
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
router.post('/cancel', withPaymentIdempotency('payment_cancel', (req) => `cancel:${req.body?.payment_intent_id || ''}`), async (req, res) => {
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