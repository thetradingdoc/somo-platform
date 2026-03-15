#!/usr/bin/env node
/**
 * Task 18: Direct Stripe / Digital Payment Testing
 *
 * Tests:
 *   1. Visit pricing API (GET /api/pricing)
 *   2. Visit pricing admin (POST /api/admin/pricing) - requires admin session
 *   3. Create appointment checkout
 *   4. Get payment methods
 *   5. Process payment with Stripe test card (pm_card_visa)
 *   6. Capture/cancel (when DEPOSIT_HOLD_ENABLED=1)
 *
 * Run: cd middleware-platform && node scripts/test-digital-payment.js
 *
 * Requires:
 *   - Server running on PORT (default 4000)
 *   - STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY (test keys)
 *   - clinic_id and merchant configured (seed-demo-accounts)
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const API_BASE = process.env.BASE_URL || process.env.API_BASE || 'http://localhost:4000';

async function fetchApi(pathname, options = {}) {
  const url = pathname.startsWith('http') ? pathname : `${API_BASE}${pathname}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, data: json };
}

async function main() {
  const results = { passed: 0, failed: 0, skipped: 0 };
  const clinicId = process.env.TEST_CLINIC_ID || 'clinic-default';

  console.log('\n🧪 Digital Payment Testing (Task 18)\n');
  console.log('  API_BASE:', API_BASE);
  console.log('  clinic_id:', clinicId);
  console.log('  STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'set' : 'NOT SET');
  console.log('  DEPOSIT_HOLD_ENABLED:', process.env.DEPOSIT_HOLD_ENABLED || '0');
  console.log('');

  // 1. GET /api/pricing
  console.log('1. GET /api/pricing');
  try {
    const r = await fetchApi(`/api/pricing?clinic_id=${clinicId}&appointment_type=General Consult`);
    if (r.ok && r.data.success && r.data.effective_price != null) {
      console.log('   ✅ PASS - effective_price:', r.data.effective_price);
      results.passed++;
    } else {
      console.log('   ❌ FAIL -', r.status, r.data);
      results.failed++;
    }
  } catch (e) {
    console.log('   ❌ ERROR:', e.message);
    results.failed++;
  }

  // 2. POST /api/admin/pricing (skipped if no admin session)
  console.log('\n2. POST /api/admin/pricing (admin auth required)');
  const adminCookie = process.env.ADMIN_SESSION_COOKIE;
  if (!adminCookie) {
    console.log('   ⏭ SKIP - set ADMIN_SESSION_COOKIE to test');
    results.skipped++;
  } else {
    try {
      const r = await fetchApi('/api/admin/pricing', {
        method: 'POST',
        headers: { Cookie: `admin_session=${adminCookie}` },
        body: JSON.stringify({
          clinic_id: clinicId,
          appointment_type: 'TestType',
          base_price: 99.99,
          surge_multiplier: 1.0,
        }),
      });
      if (r.ok && r.data.success) {
        console.log('   ✅ PASS - pricing upserted');
        results.passed++;
      } else {
        console.log('   ❌ FAIL -', r.status, r.data);
        results.failed++;
      }
    } catch (e) {
      console.log('   ❌ ERROR:', e.message);
      results.failed++;
    }
  }

  // 3. Create appointment checkout
  console.log('\n3. POST /voice/appointments/checkout');
  let checkoutId = null;
  let paymentToken = null;
  let amount = null;
  try {
    const r = await fetchApi('/voice/appointments/checkout', {
      method: 'POST',
      body: JSON.stringify({
        clinic_id: clinicId,
        appointment_type: 'General Consult',
        customer_name: 'Test Patient',
        customer_phone: '+15551234567',
        customer_email: 'test-payment@example.com',
      }),
    });
    if (r.ok && r.data.checkout_id) {
      checkoutId = r.data.checkout_id;
      paymentToken = r.data.payment_token;
      amount = r.data.amount;
      console.log('   ✅ PASS - checkout_id:', checkoutId, 'amount:', amount);
      results.passed++;
    } else {
      console.log('   ❌ FAIL -', r.status, r.data);
      results.failed++;
    }
  } catch (e) {
    console.log('   ❌ ERROR:', e.message);
    results.failed++;
  }

  // 4. GET /api/payment/methods
  console.log('\n4. GET /api/payment/methods');
  try {
    const r = await fetchApi('/api/payment/methods');
    if (r.ok && r.data.success && Array.isArray(r.data.payment_methods)) {
      console.log('   ✅ PASS - methods:', r.data.payment_methods?.length ?? 0);
      results.passed++;
    } else {
      console.log('   ❌ FAIL -', r.status, r.data);
      results.failed++;
    }
  } catch (e) {
    console.log('   ❌ ERROR:', e.message);
    results.failed++;
  }

  // 5. POST /process-payment (Stripe test card)
  console.log('\n5. POST /process-payment (Stripe test card)');
  if (!checkoutId || !process.env.STRIPE_SECRET_KEY) {
    console.log('   ⏭ SKIP - no checkout or STRIPE_SECRET_KEY');
    results.skipped++;
  } else {
    try {
      // Stripe test PaymentMethod (works in test mode)
      const r = await fetchApi('/process-payment', {
        method: 'POST',
        body: JSON.stringify({
          checkout_id: checkoutId,
          payment_method_id: 'pm_card_visa',
          amount: amount ?? 69,
          payment_method: 'stripe',
          payment_token: paymentToken,
        }),
      });
      if (r.ok && r.data.success) {
        const pi = r.data.payment_intent_id;
        const rc = r.data.requires_capture;
        console.log('   ✅ PASS - payment_intent_id:', pi, rc ? '(requires_capture)' : '');
        results.passed++;
        // 6. Capture or cancel (only if requires_capture)
        if (rc && pi) {
          console.log('\n6. POST /api/payment/capture (authorized only)');
          const cap = await fetchApi('/api/payment/capture', {
            method: 'POST',
            body: JSON.stringify({ payment_intent_id: pi }),
          });
          if (cap.ok && cap.data.success) {
            console.log('   ✅ PASS - captured');
            results.passed++;
          } else {
            console.log('   ❌ FAIL -', cap.status, cap.data);
            results.failed++;
          }
        } else {
          console.log('\n6. Capture - SKIP (immediate capture, no authorize-only)');
          results.skipped++;
        }
      } else {
        console.log('   ❌ FAIL -', r.status, r.data);
        results.failed++;
      }
    } catch (e) {
      console.log('   ❌ ERROR:', e.message);
      results.failed++;
    }
  }

  // 7. Cancel test (only if we have a requires_capture PI and didn't capture)
  // Skip - we captured above. For no-show flow you'd call cancel instead of capture.

  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
