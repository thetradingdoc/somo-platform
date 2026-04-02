const express = require('express');
const router = express.Router();
const db = require('../database');
const PaymentOrchestrator = require('../services/payment-orchestrator');
const PaymentService = require('../services/payment-service');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { assertTokenizedOnlyPaymentInput } = require('../utils/payment-input-policy');
const secureLogger = require('../services/secure-logger');

const STRICT_CHECKOUT_STAGE_GATE =
  String(process.env.STRICT_CHECKOUT_STAGE_GATE || 'true').toLowerCase() !== 'false';
const STAGE_CODE_VERIFIED = 'code_verified';
const STAGE_CHECKOUT_PREPARED = 'checkout_prepared';
const STAGE_PAYMENT_CONFIRMED = 'payment_confirmed';
const STAGE_FAILED = 'failed';
const { resolveMerchantId } = require('../utils/public-commerce-helpers');
const { normalizeToE164 } = require('../utils/phone-e164');

function normalizeSessionId(v) {
  const s = String(v || '').trim();
  return s || null;
}

function cartItemFromProduct(product, quantity) {
  const qty = Math.max(1, Number(quantity) || 1);
  const unit = Number(product.price || 0);
  return {
    product_id: product.id,
    name: product.name,
    unit_price: unit,
    quantity: qty,
    total: Number((unit * qty).toFixed(2))
  };
}

function maybeServeIdempotent(req, res, operationType) {
  const key = req.header('Idempotency-Key') || req.body?.idempotency_key || null;
  if (!key) return { key: null, reserved: true };
  const cached = db.getIdempotentResult(key, operationType);
  if (cached?.result) {
    res.status(200).json({ ...cached.result, idempotent: true });
    return { key, reserved: false, handled: true };
  }
  const reservation = db.reserveIdempotencyKey(key, operationType);
  if (reservation === 'completed') {
    const c2 = db.getIdempotentResult(key, operationType);
    if (c2?.result) {
      res.status(200).json({ ...c2.result, idempotent: true });
      return { key, reserved: false, handled: true };
    }
  }
  if (reservation === 'in_progress') {
    res.status(409).json({ success: false, error: 'request_in_progress' });
    return { key, reserved: false, handled: true };
  }
  return { key, reserved: true };
}

function maybeCompleteIdempotent(key, operationType, payload) {
  try {
    if (key && payload && payload.success) {
      db.completeIdempotentResult(key, operationType, payload);
    }
  } catch (_) {}
}

async function rejectIfCartLocked(req, res, sessionId, merchantId) {
  if (!sessionId || !merchantId) return false;
  if (await db.isCommerceCartLocked(sessionId, merchantId)) {
    res.status(409).json({
      success: false,
      error: 'cart_locked',
      message: 'Cart is locked while checkout is in progress.'
    });
    return true;
  }
  return false;
}

router.get('/cart', async (req, res) => {
  try {
    const merchantId = String(req.query.provider_id || req.query.merchant_id || '').trim() || resolveMerchantId(req);
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    const sessionId = normalizeSessionId(req.query.session_id);
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    await db.isCommerceCartLocked(sessionId, merchantId);
    const cart = db.getCommerceCart(sessionId, merchantId) || {
      id: sessionId,
      merchant_id: merchantId,
      items: [],
      subtotal: 0,
      item_count: 0,
      checkout_locked: false,
      voice_checkout_id: null
    };
    return res.json({ success: true, cart });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.get('/checkout-progress', (req, res) => {
  try {
    const merchantId = String(req.query.provider_id || req.query.merchant_id || '').trim() || resolveMerchantId(req);
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    const sessionId = normalizeSessionId(req.query.session_id);
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    const progress = db.getCommerceCheckoutProgress(sessionId, merchantId);
    return res.json({ success: true, progress: progress || null });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.post('/checkout-progress', express.json(), (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const sessionId = normalizeSessionId(req.body?.session_id);
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    const body = req.body || {};
    db.upsertCommerceCheckoutProgress({
      session_id: sessionId,
      merchant_id: merchantId,
      stage: body.stage,
      quote_id: body.quote_id,
      checkout_id: body.checkout_id,
      checkout_intent: body.checkout_intent,
      product_id: body.product_id
    });
    const progress = db.getCommerceCheckoutProgress(sessionId, merchantId);
    return res.json({ success: true, progress });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

/**
 * Email verification gate for in-chat checkout.
 * POST /api/public/commerce/email/send-code
 * Body: { email }
 */
router.post('/email/send-code', express.json(), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'email_required' });
    const EmailVerificationService = require('../services/email-verification-service');
    const r = await EmailVerificationService.sendVerificationCode(email);
    if (!r || r.success === false) {
      return res.status(500).json({ success: false, error: r?.error || 'send_failed' });
    }
    return res.json({
      success: true,
      email,
      expires_at: r.expires_at || null,
      email_sent: !!r.email_sent
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

/**
 * Email verification gate for in-chat checkout.
 * POST /api/public/commerce/email/verify-code
 * Body: { email, code }
 */
router.post('/email/verify-code', express.json(), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!email) return res.status(400).json({ success: false, error: 'email_required' });
    if (!code) return res.status(400).json({ success: false, error: 'code_required' });
    const EmailVerificationService = require('../services/email-verification-service');
    const r = await EmailVerificationService.verifyCode(email, code);
    if (!r || r.success === false) {
      return res.status(400).json({ success: false, error: r?.error || 'invalid_code' });
    }
    return res.json({ success: true, email });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.post('/cart/add', express.json(), async (req, res) => {
  try {
    const idem = maybeServeIdempotent(req, res, 'public_cart_add');
    if (idem.handled) return;
    const merchantId = resolveMerchantId(req);
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    const sessionId = normalizeSessionId(req.body?.session_id);
    const productId = String(req.body?.product_id || req.body?.prescription_id || '').trim();
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    if (!productId) return res.status(400).json({ success: false, error: 'product_id_required' });
    if (await rejectIfCartLocked(req, res, sessionId, merchantId)) return;
    const product = db.getProduct(productId);
    if (!product) return res.status(404).json({ success: false, error: 'product_not_found' });
    if (product.merchant_id && product.merchant_id !== merchantId) {
      return res.status(403).json({ success: false, error: 'product_merchant_mismatch' });
    }
    const existing = db.getCommerceCart(sessionId, merchantId);
    const items = Array.isArray(existing?.items) ? [...existing.items] : [];
    const idx = items.findIndex((it) => it.product_id === productId);
    const nextQty = (idx >= 0 ? Number(items[idx].quantity || 0) : 0) + quantity;
    const nextItem = cartItemFromProduct(product, nextQty);
    if (idx >= 0) items[idx] = nextItem;
    else items.push(nextItem);
    db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items });
    const out = { success: true, cart: db.getCommerceCart(sessionId, merchantId) };
    maybeCompleteIdempotent(idem.key, 'public_cart_add', out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.post('/cart/update', express.json(), async (req, res) => {
  try {
    const idem = maybeServeIdempotent(req, res, 'public_cart_update');
    if (idem.handled) return;
    const merchantId = resolveMerchantId(req);
    const sessionId = normalizeSessionId(req.body?.session_id);
    const productId = String(req.body?.product_id || '').trim();
    const quantity = Number(req.body?.quantity);
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    if (!productId) return res.status(400).json({ success: false, error: 'product_id_required' });
    if (!Number.isFinite(quantity)) return res.status(400).json({ success: false, error: 'quantity_required' });
    if (await rejectIfCartLocked(req, res, sessionId, merchantId)) return;
    const cart = db.getCommerceCart(sessionId, merchantId) || { items: [] };
    let items = Array.isArray(cart.items) ? [...cart.items] : [];
    if (quantity <= 0) {
      items = items.filter((it) => it.product_id !== productId);
    } else {
      const product = db.getProduct(productId);
      if (!product) return res.status(404).json({ success: false, error: 'product_not_found' });
      if (product.merchant_id && product.merchant_id !== merchantId) {
        return res.status(403).json({ success: false, error: 'product_merchant_mismatch' });
      }
      const idx = items.findIndex((it) => it.product_id === productId);
      const nextItem = cartItemFromProduct(product, quantity);
      if (idx >= 0) items[idx] = nextItem;
      else items.push(nextItem);
    }
    db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items });
    const out = { success: true, cart: db.getCommerceCart(sessionId, merchantId) };
    maybeCompleteIdempotent(idem.key, 'public_cart_update', out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.post('/cart/remove', express.json(), async (req, res) => {
  try {
    const idem = maybeServeIdempotent(req, res, 'public_cart_remove');
    if (idem.handled) return;
    const merchantId = resolveMerchantId(req);
    const sessionId = normalizeSessionId(req.body?.session_id);
    const productId = String(req.body?.product_id || '').trim();
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    if (!productId) return res.status(400).json({ success: false, error: 'product_id_required' });
    if (await rejectIfCartLocked(req, res, sessionId, merchantId)) return;
    const cart = db.getCommerceCart(sessionId, merchantId) || { items: [] };
    const items = (cart.items || []).filter((it) => it.product_id !== productId);
    db.upsertCommerceCart({ session_id: sessionId, merchant_id: merchantId, items });
    const out = { success: true, cart: db.getCommerceCart(sessionId, merchantId) };
    maybeCompleteIdempotent(idem.key, 'public_cart_remove', out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.post('/cart/clear', express.json(), (req, res) => {
  try {
    const idem = maybeServeIdempotent(req, res, 'public_cart_clear');
    if (idem.handled) return;
    const merchantId = resolveMerchantId(req);
    const sessionId = normalizeSessionId(req.body?.session_id);
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    db.clearCommerceCart(sessionId, merchantId);
    const out = { success: true, cart: { id: sessionId, merchant_id: merchantId, items: [], subtotal: 0, item_count: 0 } };
    maybeCompleteIdempotent(idem.key, 'public_cart_clear', out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

router.post('/cart/checkout', express.json(), async (req, res) => {
  try {
    const tokenizedOnly = assertTokenizedOnlyPaymentInput(req.body || {});
    if (!tokenizedOnly.ok) {
      return res.status(400).json({ success: false, error: tokenizedOnly.error, message: tokenizedOnly.message });
    }
    const idem = maybeServeIdempotent(req, res, 'public_cart_checkout');
    if (idem.handled) return;
    const merchantId = resolveMerchantId(req);
    const sessionId = normalizeSessionId(req.body?.session_id);
    const email = String(req.body?.email || '').trim();
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    if (!email) return res.status(400).json({ success: false, error: 'email_required' });
    if (STRICT_CHECKOUT_STAGE_GATE) {
      const stage = String(KellyToolExecutor._getSessionMeta(sessionId, 'checkout_stage') || '');
      const allowedStages = new Set([STAGE_CODE_VERIFIED, STAGE_CHECKOUT_PREPARED]);
      if (!allowedStages.has(stage)) {
        secureLogger.warn('[checkout-stage] gate_blocked cart/checkout', {
          session_id: sessionId,
          stage,
          required_any_of: [STAGE_CODE_VERIFIED, STAGE_CHECKOUT_PREPARED]
        });
        return res.status(409).json({
          success: false,
          error: 'verification_required',
          message: 'Email verification is required before checkout.'
        });
      }
    }
    const cart = db.getCommerceCart(sessionId, merchantId);
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      return res.status(400).json({ success: false, error: 'cart_empty' });
    }
    const shippingAddr = req.body?.shipping_address || null;
    const commerceQuoteId = String(req.body?.commerce_quote_id || req.body?.quote_id || '').trim() || null;
    const kellySessionId = String(req.body?.kelly_session_id || '').trim() || null;

    const phoneRaw = String(req.body?.phone || '').trim();
    let phoneE164 = '';
    if (phoneRaw) {
      phoneE164 = normalizeToE164(phoneRaw);
      if (!phoneE164) {
        return res.status(400).json({
          success: false,
          error: 'invalid_phone',
          message: 'Please enter a valid phone number with country code (e.g. +1 555 123 4567).'
        });
      }
    }

    const metadata = {
      cart_session_id: sessionId,
      source: 'public_commerce_cart'
    };
    if (shippingAddr) metadata.shipping_address = shippingAddr;
    if (commerceQuoteId) metadata.commerce_quote_id = commerceQuoteId;
    if (kellySessionId) metadata.kelly_session_id = kellySessionId;

    const result = await PaymentOrchestrator.createCheckout({
      merchant_id: merchantId,
      customer: {
        email,
        name: String(req.body?.name || email.split('@')[0] || 'Customer'),
        phone: phoneE164
      },
      items: cart.items.map((it) => ({
        product_id: it.product_id,
        name: it.name,
        unit_price: Number(it.unit_price),
        quantity: Number(it.quantity),
        total: Number(it.total)
      })),
      payment: { method: req.body?.payment_method || 'direct_stripe', currency: 'USD' },
      shipping_address: shippingAddr || undefined,
      metadata
    });
    if (!result || result.success === false) {
      return res.status(500).json({ success: false, error: result?.error || 'checkout_failed' });
    }
    try {
      if (result.checkout_id) {
        db.setCommerceCartCheckoutLock(sessionId, merchantId, result.checkout_id);
      }
    } catch (_) {}
    if (STRICT_CHECKOUT_STAGE_GATE) {
      try {
        KellyToolExecutor._setCheckoutStage(sessionId, STAGE_CHECKOUT_PREPARED, {
          source: 'public_commerce_cart',
          checkout_id: result.checkout_id || '',
          payment_intent_id: result.payment?.payment_intent_id || result.payment_intent_id || ''
        });
        KellyToolExecutor._setSessionMeta(
          sessionId,
          'checkout_stage_meta_payment_intent_id',
          result.payment?.payment_intent_id || result.payment_intent_id || ''
        );
        KellyToolExecutor._setSessionMeta(
          sessionId,
          'checkout_stage_meta_merchant_id',
          merchantId
        );
        secureLogger.info('[checkout-stage] transition', {
          session_id: sessionId,
          from: STAGE_CODE_VERIFIED,
          to: STAGE_CHECKOUT_PREPARED,
          checkout_id: result.checkout_id || '',
          payment_intent_id: result.payment?.payment_intent_id || result.payment_intent_id || ''
        });
      } catch (_) {}
    }
    const out = {
      success: true,
      checkout: {
        checkout_id: result.checkout_id,
        payment_link: result.payment_link || null,
        payment_token: result.payment_token || null,
        payment_intent_id: result.payment?.payment_intent_id || result.payment_intent_id || null,
        client_secret: result.payment?.client_secret || result.client_secret || null,
        requires_action: !!result.requires_action,
        payment: result.payment || null,
        message: result.message || 'Checkout prepared'
      }
    };
    maybeCompleteIdempotent(idem.key, 'public_cart_checkout', out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

/**
 * Public Stripe publishable key for in-page Elements (checkout chat / landing).
 * GET /api/public/commerce/stripe-config
 */
router.get('/stripe-config', (req, res) => {
  try {
    const publishable_key = PaymentService.getStripePublishableKey();
    return res.json({ success: true, publishable_key });
  } catch (e) {
    return res.status(503).json({ success: false, error: 'stripe_not_configured', message: e.message });
  }
});

/**
 * After stripe.confirmPayment succeeds in the browser, call this so receipt + cart unlock run
 * without relying on webhooks (local dev often has no STRIPE_WEBHOOK_SECRET).
 * POST /api/public/commerce/stripe/confirm-payment
 * Body: { payment_intent_id, provider_id? }
 */
router.post('/stripe/confirm-payment', express.json(), async (req, res) => {
  try {
    const tokenizedOnly = assertTokenizedOnlyPaymentInput(req.body || {});
    if (!tokenizedOnly.ok) {
      return res.status(400).json({ success: false, error: tokenizedOnly.error, message: tokenizedOnly.message });
    }
    const paymentIntentId = String(req.body?.payment_intent_id || '').trim();
    const requestedSessionId = String(req.body?.session_id || '').trim();
    if (!paymentIntentId) {
      return res.status(400).json({ success: false, error: 'payment_intent_id_required' });
    }
    secureLogger.info('[CommerceConfirmPayment] called', {
      payment_intent_id: paymentIntentId,
      provider_id: req.body?.provider_id || null,
      requested_session_id: requestedSessionId || null
    });
    let stripeSecret;
    try {
      stripeSecret = PaymentService.getStripeSecretKey();
    } catch (e) {
      return res.status(503).json({ success: false, error: 'stripe_not_configured', message: e.message });
    }
    const stripe = require('stripe')(stripeSecret);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const st = paymentIntent.status;
    const sid = String(paymentIntent.metadata?.cart_session_id || paymentIntent.metadata?.kelly_session_id || '').trim();
    secureLogger.info('[CommerceConfirmPayment] lineage', {
      payment_intent_id: paymentIntentId,
      requested_session_id: requestedSessionId || null,
      metadata_session_id: sid || null,
      metadata_checkout_id: String(paymentIntent.metadata?.checkout_id || '').trim() || null,
      status: st
    });
    if (requestedSessionId && sid && requestedSessionId !== sid) {
      return res.status(409).json({
        success: false,
        error: 'payment_intent_session_mismatch',
        message: 'Payment intent does not belong to this checkout session.'
      });
    }
    const writePaymentMeta = (status, source) => {
      if (!sid || !KellyToolExecutor || typeof KellyToolExecutor._setSessionMeta !== 'function') return;
      KellyToolExecutor._setSessionMeta(sid, 'payment_outcome_status', String(status || 'unknown'));
      KellyToolExecutor._setSessionMeta(sid, 'payment_status_last_checked_at', String(Date.now()));
      KellyToolExecutor._setSessionMeta(sid, 'payment_status_source', String(source || 'stripe_confirm_payment'));
      KellyToolExecutor._setSessionMeta(sid, 'payment_confirm_attempted', '1');
    };
    secureLogger.info('[CommerceConfirmPayment] retrieved PI', {
      payment_intent_id: paymentIntent.id,
      status: st
    });
    if (st !== 'succeeded' && st !== 'processing') {
      writePaymentMeta(st, 'stripe_confirm_payment');
      if (sid && KellyToolExecutor && typeof KellyToolExecutor._setCheckoutStage === 'function') {
        KellyToolExecutor._setCheckoutStage(sid, STAGE_FAILED, {
          reason: String(st || 'payment_failed'),
          payment_intent_id: paymentIntentId
        });
      }
      return res.status(400).json({ success: false, error: 'payment_not_completed', status: st });
    }
    if (STRICT_CHECKOUT_STAGE_GATE) {
      if (sid) {
        const stage = String(KellyToolExecutor._getSessionMeta(sid, 'checkout_stage') || '');
        if (stage !== STAGE_CHECKOUT_PREPARED) {
          secureLogger.warn('[checkout-stage] gate_blocked stripe/confirm-payment', {
            session_id: sid,
            stage,
            required: STAGE_CHECKOUT_PREPARED,
            payment_intent_id: paymentIntentId
          });
          return res.status(409).json({
            success: false,
            error: 'checkout_not_prepared',
            message: 'Checkout must be prepared after verification before payment confirmation.'
          });
        }
      }
    }
    const mdMerchant = String(paymentIntent.metadata?.merchant_id || '').trim();
    const merchantId = resolveMerchantId(req);
    if (merchantId && mdMerchant && mdMerchant !== merchantId) {
      return res.status(403).json({ success: false, error: 'merchant_mismatch' });
    }
    const {
      reconcileMerchantOrderPaymentSucceeded,
      finalizeCommerceRetailPayment
    } = require('../services/commerce-payment-settlement');
    if (st === 'succeeded') {
      await reconcileMerchantOrderPaymentSucceeded(paymentIntent);
      await finalizeCommerceRetailPayment(paymentIntent, paymentIntent.amount);
    }
    try {
      writePaymentMeta(st, 'stripe_confirm_payment');
      if (sid && KellyToolExecutor && typeof KellyToolExecutor._setSessionMeta === 'function') {
        if (st === 'succeeded') {
          let retrievable = false;
          try {
            const hasReceipt = db.db.prepare(
              `SELECT 1 FROM payment_receipts WHERE external_payment_id = ? AND deleted_at IS NULL LIMIT 1`
            ).get(paymentIntentId);
            const hasOrder = db.db.prepare(
              `SELECT 1 FROM voice_checkouts WHERE payment_intent_id = ? AND merchant_order_id IS NOT NULL LIMIT 1`
            ).get(paymentIntentId);
            retrievable = !!(hasReceipt || hasOrder);
          } catch (_) {}
          if (retrievable) {
            KellyToolExecutor._setCheckoutStage(sid, STAGE_PAYMENT_CONFIRMED, {
              source: 'stripe_confirm_payment',
              payment_intent_id: paymentIntentId
            });
            KellyToolExecutor._setSessionMeta(sid, 'commerce_email_verified', '');
            KellyToolExecutor._setSessionMeta(sid, 'commerce_email_verified_nonce', '');
            KellyToolExecutor._setSessionMeta(sid, 'commerce_email_verified_at_ms', '0');
            KellyToolExecutor._setSessionMeta(sid, 'commerce_email_pending_nonce', '');
            KellyToolExecutor._setSessionMeta(sid, 'commerce_email_pending', '');
          } else {
            KellyToolExecutor._setCheckoutStage(sid, STAGE_CHECKOUT_PREPARED, {
              source: 'stripe_confirm_payment',
              payment_intent_id: paymentIntentId
            });
            KellyToolExecutor._setSessionMeta(sid, 'payment_status_source', 'stripe_confirm_payment:awaiting_reconciliation');
            try {
              db.enqueueToolCallDLQ && db.enqueueToolCallDLQ({
                call_id: `checkout_reconcile_${sid}_${Date.now()}`,
                function_name: 'checkout_payment_reconciliation',
                parameters: { session_id: sid, payment_intent_id: paymentIntentId },
                error_message: 'payment_succeeded_but_receipt_or_order_unavailable'
              });
            } catch (_) {}
          }
        } else if (st === 'processing') {
          KellyToolExecutor._setCheckoutStage(sid, STAGE_CHECKOUT_PREPARED, {
            source: 'stripe_confirm_payment',
            payment_intent_id: paymentIntentId
          });
        }
        secureLogger.info('[checkout-stage] transition', {
          session_id: sid,
          from: STAGE_CHECKOUT_PREPARED,
          to:
            st === 'succeeded'
              ? String(KellyToolExecutor._getSessionMeta(sid, 'checkout_stage') || STAGE_CHECKOUT_PREPARED)
              : STAGE_CHECKOUT_PREPARED,
          payment_intent_id: paymentIntentId
        });
      }
    } catch (_) {}
    return res.json({ success: true, payment_intent_id: paymentIntent.id, status: st });
  } catch (e) {
    secureLogger.warn('[CommerceConfirmPayment] error', { error: e && e.message ? e.message : String(e || 'unknown') });
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

module.exports = router;
