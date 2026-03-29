const express = require('express');
const router = express.Router();
const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const PaymentOrchestrator = require('../services/payment-orchestrator');
const PaymentService = require('../services/payment-service');
const {
  resolvePrescriptionId,
  withProviderAliases,
  withPrescriptionAliases,
  logAliasUsage
} = require('../utils/naming-aliases');
const {
  resolveMerchantId,
  parseCheckoutSessionData,
  isQuoteExpired
} = require('../utils/public-commerce-helpers');

function validateShippingAddress(addr) {
  if (addr == null || addr === '') return { ok: true };
  if (typeof addr === 'string') {
    const t = addr.trim();
    if (t.length < 8) return { ok: false, error: 'shipping_address_invalid' };
    return { ok: true };
  }
  if (typeof addr === 'object') {
    const line1 = String(addr.line1 || addr.street || addr.address_line1 || '').trim();
    const city = String(addr.city || '').trim();
    const postal = String(addr.postal_code || addr.zip || addr.postal || '').trim();
    if (!line1 || !city || !postal) return { ok: false, error: 'shipping_address_incomplete' };
    return { ok: true };
  }
  return { ok: false, error: 'shipping_address_invalid' };
}

function markQuotePaymentPending(quoteId, checkoutPayload) {
  try {
    const row = db.getCheckoutSession(quoteId);
    if (!row) return;
    const prev = parseCheckoutSessionData(row.session_data) || {};
    const next = {
      ...prev,
      kind: 'commerce_quote',
      voice_checkout_id: checkoutPayload.checkout_id || null,
      payment_token: checkoutPayload.payment_token || null
    };
    db.updateCheckoutSession(quoteId, 'payment_pending', next);
  } catch (_) {}
}

async function fallbackCreatePaymentLinkCheckout({
  merchantId,
  product,
  quantity,
  customer
}) {
  const checkoutId = uuidv4();
  const checkout = {
    id: checkoutId,
    merchant_id: merchantId,
    product_id: product.id,
    product_name: product.name,
    quantity,
    amount: Number(product.price || 0) * quantity,
    customer_phone: customer.phone_number || '0000000000',
    customer_name: customer.name || customer.email || 'Customer',
    customer_email: customer.email || null,
    status: 'pending'
  };
  await db.createVoiceCheckout(checkout);
  const paymentToken = PaymentService.createPaymentToken(checkoutId);
  const paymentLink = `${process.env.BASE_URL || 'http://localhost:4000'}/payment/${paymentToken}`;
  return {
    checkout_id: checkoutId,
    payment_link: paymentLink,
    payment_token: paymentToken,
    payment_intent_id: null,
    client_secret: null,
    requires_action: true,
    payment: {
      method: 'link',
      status: 'pending',
      amount: checkout.amount,
      currency: 'USD'
    },
    message: 'Checkout created with payment link fallback'
  };
}

// Public checkout: charge amounts come only from PaymentOrchestrator (DB product price × qty); do not trust client totals.
// Optional quote_id ties to checkout_sessions (platform commerce_quote) from POST /api/public/commerce/quote.
router.post('/start', async (req, res) => {
  const idempotencyKey = req.header('Idempotency-Key') || req.body?.idempotency_key || null;
  const operationType = 'public_checkout_start';

  if (idempotencyKey) {
    const cached = db.getIdempotentResult(idempotencyKey, operationType);
    if (cached?.result) {
      return res.status(200).json({ ...cached.result, idempotent: true });
    }
    const reservation = db.reserveIdempotencyKey(idempotencyKey, operationType);
    if (reservation === 'completed') {
      const c2 = db.getIdempotentResult(idempotencyKey, operationType);
      if (c2?.result) return res.status(200).json({ ...c2.result, idempotent: true });
    }
    if (reservation === 'in_progress') {
      return res.status(409).json({ success: false, error: 'checkout_in_progress' });
    }
  }

  const releaseIdem = () => {
    if (idempotencyKey) db.releaseIdempotencyKey(idempotencyKey, operationType);
  };

  const finishSuccess = (payload) => {
    try {
      if (idempotencyKey && payload && payload.success) {
        db.completeIdempotentResult(idempotencyKey, operationType, payload);
      }
    } catch (_) {}
    return res.json(payload);
  };

  try {
    logAliasUsage('public-checkout-start', req);
    const { email, phone, name, quantity, payment_method, payment_method_id, shipping_address, kelly_session_id } =
      req.body || {};
    const quoteId = (req.body || {}).quote_id || (req.body || {}).checkout_session_id || null;

    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      releaseIdem();
      return res.status(400).json({ success: false, error: 'merchant_not_found' });
    }
    if (!email && !phone) {
      releaseIdem();
      return res.status(400).json({ success: false, error: 'email_or_phone_required' });
    }

    const shipCheck = validateShippingAddress(shipping_address);
    if (!shipCheck.ok) {
      releaseIdem();
      return res.status(400).json({ success: false, error: shipCheck.error });
    }

    let quoteRow = null;
    let quoteData = null;
    if (quoteId) {
      quoteRow = db.getCheckoutSession(quoteId);
      if (!quoteRow || quoteRow.platform !== 'commerce_quote') {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'invalid_quote' });
      }
      if (quoteRow.merchant_id !== merchantId) {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'quote_merchant_mismatch' });
      }
      if (quoteRow.status !== 'quoted') {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'quote_already_used' });
      }
      if (isQuoteExpired(quoteRow)) {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'quote_expired' });
      }
      quoteData = parseCheckoutSessionData(quoteRow.session_data);
      if (!quoteData || quoteData.kind !== 'commerce_quote') {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'invalid_quote' });
      }
      if (quoteData.merchant_id !== merchantId) {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'invalid_quote' });
      }
    }

    let productId = resolvePrescriptionId(req.body || {});
    if (quoteData) {
      if (productId && productId !== quoteData.product_id) {
        releaseIdem();
        return res.status(400).json({ success: false, error: 'product_quote_mismatch' });
      }
      productId = quoteData.product_id;
    }

    let customer = null;
    if (email) customer = db.getCustomerByEmail(email);
    if (!customer && phone) customer = db.getCustomerByPhone(phone);

    if (!customer) {
      const id = uuidv4();
      db.createCustomer({
        id,
        name: name || email || phone || 'Customer',
        email: email || null,
        phone_number: phone || null,
        merchant_id: merchantId,
        status: 'active',
        customer_type: 'shop'
      });
      customer = db.getCustomer(id);
    }

    try {
      const CircleService = require('../services/circle-service');
      if (CircleService && CircleService.isAvailable && CircleService.isAvailable()) {
        CircleService.getOrCreateCustomerWallet(customer.id, { merchantId: merchantId, createIfNotExists: true });
      }
    } catch (_) {}

    const responsePayload = {
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        phone_number: customer.phone_number,
        provider_id: merchantId,
        merchant_id: merchantId
      }
    };

    if (!productId) {
      return finishSuccess(responsePayload);
    }

    let qty = Number.isFinite(Number(quantity)) ? Math.max(1, Number(quantity)) : 1;
    if (quoteData && quoteData.quantity) {
      qty = quoteData.quantity;
    }

    const product = db.getProduct(productId);
    if (!product) {
      releaseIdem();
      return res.status(404).json({ success: false, error: 'product_not_found' });
    }
    if (product.merchant_id && product.merchant_id !== merchantId) {
      releaseIdem();
      return res.status(403).json({ success: false, error: 'product_merchant_mismatch' });
    }
    if (Number(product.inventory || 0) < qty) {
      releaseIdem();
      return res.status(400).json({ success: false, error: 'insufficient_inventory' });
    }

    const expectedCents = Math.round(Number(product.price || 0) * 100) * qty;
    if (quoteData && quoteData.amount_cents !== expectedCents) {
      releaseIdem();
      return res.status(409).json({ success: false, error: 'quote_stale', message: 'Price changed; request a new quote.' });
    }

    const checkoutRequest = {
      merchant_id: merchantId,
      customer: {
        name: customer.name || name || 'Customer',
        phone: customer.phone_number || phone || null,
        email: customer.email || email || null
      },
      items: [{ product_id: productId, quantity: qty }],
      payment: {
        method: payment_method || 'direct_stripe',
        currency: 'USD'
      },
      totals: {},
      source: {
        protocol: 'public',
        platform: 'landing',
        input_type: 'text'
      },
      metadata: {
        customer_id: customer.id,
        payment_method_id: payment_method_id || null,
        commerce_quote_id: quoteId || null,
        shipping_address: shipping_address || null,
        kelly_session_id: kelly_session_id || null
      }
    };

    let checkoutResult;
    try {
      checkoutResult = await PaymentOrchestrator.createCheckout(checkoutRequest);
    } catch (orchestratorError) {
      console.error('Public checkout orchestrator error:', orchestratorError);
      try {
        const fallbackCheckout = await fallbackCreatePaymentLinkCheckout({
          merchantId,
          product,
          quantity: qty,
          customer
        });
        if (quoteId) markQuotePaymentPending(quoteId, fallbackCheckout);
        return finishSuccess({
          ...responsePayload,
          checkout: withProviderAliases(withPrescriptionAliases(fallbackCheckout, productId), merchantId),
          warning: 'stripe_unavailable_fallback_to_link'
        });
      } catch (fallbackError) {
        console.error('Public checkout fallback error:', fallbackError);
        releaseIdem();
        return res.status(500).json({
          success: false,
          error: 'checkout_create_failed',
          message: fallbackError.message
        });
      }
    }

    if (!checkoutResult?.success) {
      const fallbackCheckout = await fallbackCreatePaymentLinkCheckout({
        merchantId,
        product,
        quantity: qty,
        customer
      });
      if (quoteId) markQuotePaymentPending(quoteId, fallbackCheckout);
      return finishSuccess({
        ...responsePayload,
        checkout: withPrescriptionAliases(fallbackCheckout, productId),
        warning: checkoutResult?.error || 'stripe_unavailable_fallback_to_link'
      });
    }

    const checkoutPayload = withPrescriptionAliases(
      {
        checkout_id: checkoutResult.checkout_id,
        payment_link: checkoutResult.payment_link || null,
        payment_token: checkoutResult.payment_token || null,
        payment_intent_id: checkoutResult.payment_intent_id || null,
        client_secret: checkoutResult.client_secret || null,
        requires_action: !!checkoutResult.requires_action,
        payment: checkoutResult.payment || null,
        message: checkoutResult.message || 'Checkout created'
      },
      productId
    );

    if (quoteId) markQuotePaymentPending(quoteId, checkoutPayload);

    return finishSuccess({
      ...responsePayload,
      checkout: withProviderAliases(checkoutPayload, merchantId),
      quote_id: quoteId || undefined
    });
  } catch (error) {
    console.error('Public checkout start error:', error);
    releaseIdem();
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;
