const express = require('express');
const router = express.Router();
const db = require('../database');
const PaymentOrchestrator = require('../services/payment-orchestrator');
const PaymentService = require('../services/payment-service');
const { resolveMerchantId } = require('../utils/public-commerce-helpers');

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
    const idem = maybeServeIdempotent(req, res, 'public_cart_checkout');
    if (idem.handled) return;
    const merchantId = resolveMerchantId(req);
    const sessionId = normalizeSessionId(req.body?.session_id);
    const email = String(req.body?.email || '').trim();
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_found' });
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id_required' });
    if (!email) return res.status(400).json({ success: false, error: 'email_required' });
    const cart = db.getCommerceCart(sessionId, merchantId);
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      return res.status(400).json({ success: false, error: 'cart_empty' });
    }
    const shippingAddr = req.body?.shipping_address || null;
    const commerceQuoteId = String(req.body?.commerce_quote_id || req.body?.quote_id || '').trim() || null;
    const kellySessionId = String(req.body?.kelly_session_id || '').trim() || null;

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
        phone: String(req.body?.phone || '')
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
    const paymentIntentId = String(req.body?.payment_intent_id || '').trim();
    if (!paymentIntentId) {
      return res.status(400).json({ success: false, error: 'payment_intent_id_required' });
    }
    console.log('[CommerceConfirmPayment] called', {
      payment_intent_id: paymentIntentId,
      provider_id: req.body?.provider_id || null
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
    console.log('[CommerceConfirmPayment] retrieved PI', {
      payment_intent_id: paymentIntent.id,
      status: st
    });
    if (st !== 'succeeded' && st !== 'processing') {
      return res.status(400).json({ success: false, error: 'payment_not_completed', status: st });
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
    await reconcileMerchantOrderPaymentSucceeded(paymentIntent);
    await finalizeCommerceRetailPayment(paymentIntent, paymentIntent.amount);
    return res.json({ success: true, payment_intent_id: paymentIntent.id, status: st });
  } catch (e) {
    console.warn('[CommerceConfirmPayment] error:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

module.exports = router;
