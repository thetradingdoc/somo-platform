/**
 * Offline smoke test: create a "payment link" checkout and send email.
 *
 * Why this exists:
 * - The sandbox often cannot reach Stripe, so we can't exercise link-by-confirming-PIs.
 * - This script exercises the secure payment link email path directly via
 *   `PaymentOrchestrator.createCheckout({ payment.method: 'link' })`.
 *
 * What it does:
 * 1) Ensures `EMAIL` is marked as verified in `email_verification_codes` (DB-only).
 * 2) Calls `PaymentOrchestrator.createCheckout` using seeded merchant/product IDs.
 * 3) `PaymentOrchestrator._handleLinkPayment()` generates a `/payment/:token` link
 *    and calls `EmailService.sendPaymentLinkEmail(...)`.
 *
 * Run:
 *   cd middleware-platform
 *   export DB_PATH=./middleware-dev.db
 *   export EMAIL="drlittlekids@gmail.com"
 *   node scripts/test-payment-link-email.cjs
 */
'use strict';

const db = require('../database');
const PaymentOrchestrator = require('../services/payment-orchestrator');

function rand6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function main() {
  const email = (process.env.EMAIL || 'drlittlekids@gmail.com').toLowerCase().trim();
  const merchantId = process.env.PROVIDER_ID || 'merchant_c3d547a10f43eeec';
  const productId = process.env.PRODUCT_ID || 'prod-retinol-peptide-night-serum';
  const phone = process.env.PHONE || '+15555550123';
  const name = process.env.NAME || 'Test Patient';

  const product = db.getProduct(productId);
  if (!product) throw new Error(`Seed product not found: ${productId}`);

  // Ensure email is treated as verified (link payments require it).
  const code = rand6();
  db.createEmailVerificationCode(email, code, null);
  db.verifyEmailCode(email, code);
  console.log('[PaymentLinkEmailTest] email verified in DB for:', email);

  const checkout = await PaymentOrchestrator.createCheckout({
    merchant_id: merchantId,
    customer: { email, name, phone },
    items: [
      {
        product_id: productId,
        name: product.name,
        unit_price: product.price,
        quantity: 1,
        total: Number(product.price) * 1
      }
    ],
    // totals are calculated server-side from item totals; these are just placeholders.
    totals: { subtotal: Number(product.price), tax: 0, shipping: 0, total: Number(product.price) },
    payment: { method: 'link', currency: 'USD' },
    shipping_address: {
      line1: process.env.SHIP_LINE1 || '1 Test St',
      city: process.env.SHIP_CITY || 'Austin',
      state: process.env.SHIP_STATE || 'TX',
      postal_code: process.env.SHIP_POSTAL || '78701'
    },
    metadata: { source: 'offline_test' }
  });

  console.log('[PaymentLinkEmailTest] createCheckout result:', checkout);
  console.log('[PaymentLinkEmailTest] Look in output above for "📧" with To:', email);
}

main().catch((e) => {
  console.error('[PaymentLinkEmailTest] failed:', e && e.message ? e.message : e);
  process.exit(1);
});

