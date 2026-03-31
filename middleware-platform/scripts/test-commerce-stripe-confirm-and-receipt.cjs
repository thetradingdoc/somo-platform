/**
 * Smoke test: create commerce checkout -> confirm PI -> call confirm-payment endpoint.
 *
 * Objective:
 * - Exercise `POST /api/public/commerce/stripe/confirm-payment`
 * - Ensure it triggers `finalizeCommerceRetailPayment` -> `completePaymentSuccess`
 * - Confirm receipt email path runs (SMTP if configured, otherwise "EMAIL (SIMULATED)").
 *
 * Run:
 *   node scripts/test-commerce-stripe-confirm-and-receipt.cjs
 *
 * Notes:
 * - Requires STRIPE_SECRET_KEY configured (it must already be configured for your app,
 *   because PaymentOrchestrator created PaymentIntents earlier).
 * - Uses Stripe test payment method `pm_card_visa`.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Ensure this script picks up the same env vars the server uses.
// (Your server uses dotenv injection; in this sandboxed runner env vars may not be present.)
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // If dotenv isn't available or file missing, we'll fall back to process.env.
}

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';

// Use the seeded merchant/product from your project logs.
const providerId = process.env.PROVIDER_ID || 'merchant_c3d547a10f43eeec';
const productId = process.env.PRODUCT_ID || 'prod-retinol-peptide-night-serum';

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body || {})
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function main() {
  const sessionId = process.env.SESSION_ID || ('cs_' + uuidv4());
  const email = process.env.EMAIL || ('e2e-' + uuidv4().slice(0, 8) + '@example.com');
  const name = process.env.NAME || 'Test Patient';
  const phone = process.env.PHONE || '+15555550123';
  const shippingAddress = {
    line1: process.env.SHIP_LINE1 || '1 Test St',
    city: process.env.SHIP_CITY || 'Austin',
    state: process.env.SHIP_STATE || 'TX',
    postal_code: process.env.SHIP_POSTAL || '78701'
  };

  console.log('[StripeConfirmReceipt] sessionId:', sessionId);
  console.log('[StripeConfirmReceipt] providerId:', providerId);
  console.log('[StripeConfirmReceipt] productId:', productId);

  // 1) Add item to cart
  const addUrl = `${BASE}/api/public/commerce/cart/add`;
  const add = await postJson(addUrl, {
    session_id: sessionId,
    provider_id: providerId,
    product_id: productId,
    quantity: 1
  });
  if (!add.res.ok || add.payload?.success === false) {
    throw new Error(`cart/add failed: ${add.res.status} ${add.payload?.error || add.payload?.message || 'unknown'}`);
  }

  // 2) Create checkout (creates Stripe PI + client_secret)
  const checkoutUrl = `${BASE}/api/public/commerce/cart/checkout`;
  const checkout = await postJson(checkoutUrl, {
    session_id: sessionId,
    provider_id: providerId,
    email,
    name,
    phone,
    shipping_address: shippingAddress,
    payment_method: 'direct_stripe'
  });
  if (!checkout.res.ok || checkout.payload?.success === false) {
    throw new Error(`cart/checkout failed: ${checkout.res.status} ${checkout.payload?.error || checkout.payload?.message || 'unknown'}`);
  }

  const piId =
    checkout.payload?.checkout?.payment_intent_id ||
    checkout.payload?.checkout?.payment?.payment_intent_id ||
    checkout.payload?.payment_intent_id;

  if (!piId) {
    throw new Error(`Missing payment_intent_id in checkout payload keys: ${Object.keys(checkout.payload || {}).join(', ')}`);
  }
  console.log('[StripeConfirmReceipt] created checkout PI:', piId);

  // 3) Confirm PI on Stripe using a test payment method
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY not set');
  const stripe = require('stripe')(stripeSecret);

  // Confirm using a known test PaymentMethod.
  // Stripe may require a `return_url` when some enabled methods redirect.
  const returnUrl = `${BASE.replace(/\/$/, '')}/api/payment/success`;
  const confirmed = await stripe.paymentIntents.confirm(piId, {
    payment_method: 'pm_card_visa',
    return_url: returnUrl
  });
  const st = confirmed.status;
  console.log('[StripeConfirmReceipt] Stripe confirm status:', st);

  // Wait a moment for async settlement if needed.
  await new Promise((r) => setTimeout(r, 1500));

  // 4) Call our backend confirm-payment endpoint to finalize/emit receipt email.
  const confirmUrl = `${BASE}/api/public/commerce/stripe/confirm-payment`;
  const final = await postJson(confirmUrl, {
    payment_intent_id: piId,
    provider_id: providerId
  });

  if (!final.res.ok || final.payload?.success === false) {
    throw new Error(
      `confirm-payment failed: ${final.res.status} ${final.payload?.error || final.payload?.message || 'unknown'}`
    );
  }

  console.log('[StripeConfirmReceipt] backend finalize response:', final.payload);
}

main().catch((e) => {
  console.error('[StripeConfirmReceipt] failed:', e && e.message ? e.message : e);
  process.exit(1);
});

