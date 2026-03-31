/**
 * Deterministically exercise payment receipt email path (no Stripe dependency).
 *
 * What it does:
 * - Inserts a minimal `voice_checkout` record with customer_email
 * - Calls PaymentProcessorService.completePaymentSuccess(...)
 * - EmailService.sendPaymentReceipt(...) should send via SMTP/Azure if configured,
 *   otherwise it falls back to "EMAIL (SIMULATED)" console output.
 *
 * Run:
 *   node scripts/test-payment-receipt-email.cjs
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

const db = require('../database');
const PaymentProcessorService = require('../services/payment-processor-service');

async function main() {
  const checkoutId = 'chk_email_test_' + uuidv4();
  // Use known seeded IDs so the `voice_checkouts` foreign keys are satisfied.
  // (voice_checkouts.merchant_id -> merchants.id, voice_checkouts.clinic_id -> clinics.clinic_id, voice_checkouts.product_id -> products.id)
  const merchantId = 'merchant_c3d547a10f43eeec';
  const clinicId = 'clinic-default';
  const productId = 'prod-retinol-peptide-night-serum';

  // Keep this as a minimal retail/commerce-style checkout (no appointment).
  const checkout = {
    id: checkoutId,
    clinic_id: clinicId,
    merchant_id: merchantId,
    product_id: productId,
    product_name: 'Receipt Email Test Product',
    quantity: 1,
    amount: 29.99,
    customer_phone: '+15555550123',
    customer_name: 'Test Patient',
    // Allow deterministic recipient for manual verification.
    // If EMAIL isn't provided, use a unique inbox-like value.
    customer_email: process.env.EMAIL
      ? String(process.env.EMAIL).trim()
      : 'email-test-' + uuidv4().slice(0, 8) + '@example.com',
    appointment_id: null,
    payment_method: 'stripe',
    status: 'completed',
    created_at: new Date().toISOString()
  };

  const created = db.createVoiceCheckout ? await db.createVoiceCheckout(checkout) : null;
  console.log('[EmailTest] created voice_checkout:', created || { ok: true, id: checkoutId });

  const paymentIntentId = 'pi_email_test_' + uuidv4();
  await PaymentProcessorService.completePaymentSuccess({
    checkout,
    amount: checkout.amount,
    paymentMethod: 'stripe',
    paymentIntentId
  });

  console.log('[EmailTest] done. Look for "📧 Email sent" or "EMAIL (SIMULATED)" in output above.');
}

main().catch((e) => {
  console.error('[EmailTest] failed:', e && e.message ? e.message : e);
  process.exit(1);
});

