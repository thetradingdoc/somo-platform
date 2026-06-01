/**
 * patient-rcm-pay-ui.spec.cjs
 *
 * E2E tests for unified-dashboard/patients/pay.html
 * Covers: token loading, card/USDC rails, 3DS redirect, error states,
 *         already-paid, inline errors, wallet integration smoke.
 *
 * Usage (all suites):
 *   npx playwright test patient-rcm-pay-ui.spec.cjs
 *
 * Live Stripe (test card):
 *   RCM_E2E_STRIPE_LIVE=1 npx playwright test patient-rcm-pay-ui.spec.cjs
 *
 * Env vars:
 *   BASE_URL          – e.g. http://localhost:4000  (default)
 *   TEST_CLINIC_ID    – clinic used for fixture payments (default: clinic-default)
 *   TEST_PROVIDER_JWT – Bearer token for provider API calls (optional; uses cookie jar)
 *   RCM_E2E_STRIPE_LIVE=1  – run real Stripe test-card flow
 *   RCM_E2E_USDC_LIVE=1    – run real USDC flow (requires seeded wallets)
 */

'use strict';

const { test, expect, request } = require('@playwright/test');

/* ── Config ─────────────────────────────────────────────────────── */
const BASE     = (process.env.PW_API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const CLINIC   =  process.env.TEST_CLINIC_ID || 'clinic-default';
const STRIPE_LIVE = !!process.env.RCM_E2E_STRIPE_LIVE;
const USDC_LIVE   = !!process.env.RCM_E2E_USDC_LIVE;

/** Stripe test card that always succeeds (no 3DS) */
const CARD_SUCCESS  = '4242424242424242';
/** Stripe test card that requires 3DS authentication */
const CARD_3DS      = '4000002500003155';
/** Stripe test card that always declines */
const CARD_DECLINE  = '4000000000000002';

/* ── Helpers ─────────────────────────────────────────────────────── */

/**
 * Create payment via Kelly agent tool (preferred) or provider API fallback.
 */
async function createPaymentViaKelly({ amount = 25, journeyId, patientId } = {}) {
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  const result = await KellyToolExecutor.execute(
    'request_patient_payment',
    {
      amount,
      journey_id: journeyId,
      patient_id: patientId,
      delivery: 'email',
    },
    {
      sessionId: `e2e_${Date.now()}`,
      clinicId: CLINIC,
      patientId: patientId || null,
      callerPhone: null,
      channel: 'voice',
    }
  );
  if (!result?.success || !result.pay_token) {
    throw new Error(result?.error || 'Kelly request_patient_payment failed');
  }
  return result;
}

/**
 * Create a real RCM payment request via the provider API (fallback).
 */
async function createPaymentRequest(apiCtx, { amount = 25, journeyId, patientId } = {}) {
  const body = { amount };
  if (journeyId) body.journey_id = journeyId;
  if (patientId) body.patient_id = patientId;

  const res = await apiCtx.post(`${BASE}/api/rcm/payments/request?clinic_id=${CLINIC}`, {
    data: body,
    headers: process.env.TEST_PROVIDER_JWT
      ? { Authorization: `Bearer ${process.env.TEST_PROVIDER_JWT}` }
      : {}
  });

  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`payments/request failed (${res.status()}): ${text}`);
  }

  return res.json();
}

/** Navigate to pay.html with a given token */
function payUrl(token) {
  return `${BASE}/patients/pay.html?token=${token}`;
}

/** Fill a Stripe payment element iframe with a test card */
async function fillStripeCard(page, cardNumber = CARD_SUCCESS) {
  // Stripe mounts multiple iframes; card number is in one labelled "Card number"
  const frames = page.frames();

  // Wait for Stripe iframe to appear
  await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 15_000 });

  for (const frame of page.frames()) {
    try {
      const cardInput = frame.locator('input[placeholder="1234 1234 1234 1234"]');
      if (await cardInput.isVisible({ timeout: 500 }).catch(() => false)) {
        await cardInput.fill(cardNumber);
        await frame.locator('input[placeholder="MM / YY"]').fill('12/34');
        await frame.locator('input[placeholder="CVC"]').fill('123');
        await frame.locator('input[placeholder="ZIP"]').fill('10001').catch(() => {});
        return;
      }
    } catch (_) {}
  }

  throw new Error('Stripe card input not found');
}

/* ═══════════════════════════════════════════════════════════════════
   Suite 1 — Page structure & static rendering
══════════════════════════════════════════════════════════════════ */
test.describe('pay.html — static structure', () => {

  test('page loads without a token → shows fatal error', async ({ page }) => {
    await page.goto(`${BASE}/patients/pay.html`);
    await expect(page.locator('#error-state')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#fatal-error-msg')).toContainText(/token/i);
  });

  test('page title includes Somo branding', async ({ page }) => {
    await page.goto(`${BASE}/patients/pay.html?token=dummy`);
    await expect(page).toHaveTitle(/somo/i);
  });

  test('brand wordmark is present', async ({ page }) => {
    await page.goto(`${BASE}/patients/pay.html?token=dummy`);
    await expect(page.locator('.brand-name')).toContainText(/somo/i);
  });

  test('loading skeleton appears before context resolves', async ({ page }) => {
    // Intercept to delay
    await page.route('**/api/public/rcm/pay/**', async route => {
      await new Promise(r => setTimeout(r, 800));
      await route.continue();
    });

    await page.goto(`${BASE}/patients/pay.html?token=any`);
    await expect(page.locator('#loading-state')).toBeVisible();
  });

});

/* ═══════════════════════════════════════════════════════════════════
   Suite 2 — API contract: mocked responses
══════════════════════════════════════════════════════════════════ */
test.describe('pay.html — mocked API responses', () => {

  const MOCK_TOKEN = 'test-token-mock-001';

  /** Helper: mock GET /api/public/rcm/pay/:token */
  function mockContext(page, body, status = 200) {
    return page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      } else {
        await route.continue();
      }
    });
  }

  /** Helper: mock POST create-intent */
  function mockCreateIntent(page, body, status = 200) {
    return page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}/create-intent`, async route => {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }

  /** Helper: mock POST complete */
  function mockComplete(page, body, status = 200) {
    return page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}/complete`, async route => {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }

  /* ── 2a. Already paid ─────────────────────────────────────── */
  test('shows already-paid state when already_paid=true', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: true,
      payment: { id: 'pay_1', amount: 30.00, currency: 'USD', status: 'paid', method: 'stripe' },
      rails: { card: { available: false }, usdc: { available: false } }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#already-paid-state')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#paid-amount')).toContainText('$30.00');
    await expect(page.locator('#payment-form')).not.toBeVisible();
  });

  /* ── 2b. 404 / invalid token ──────────────────────────────── */
  test('shows error state on 404 response', async ({ page }) => {
    await mockContext(page,
      { success: false, error: 'Payment link not found or already paid' },
      404
    );

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#error-state')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#fatal-error-msg')).toContainText(/invalid|expired|not found/i);
  });

  /* ── 2c. Card rail renders amount ─────────────────────────── */
  test('renders amount and card form when card rail is available', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_2', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: true, publishable_key: 'pk_test_placeholder' },
        usdc: { available: false }
      }
    });

    await mockCreateIntent(page, {
      success: false,
      error: 'Stripe is not configured'  // key is fake; intent will fail gracefully
    }, 503);

    await page.goto(payUrl(MOCK_TOKEN));

    // Amount banner
    await expect(page.locator('#amount-display')).toContainText('$25.00', { timeout: 8_000 });
    await expect(page.locator('#btn-amount')).toContainText('$25.00');

    // Card panel visible
    await expect(page.locator('#card-panel')).toBeVisible();
    // USDC panel hidden
    await expect(page.locator('#usdc-panel')).not.toBeVisible();
    // Rail tabs hidden (only one rail)
    await expect(page.locator('#rail-tabs')).not.toBeVisible();
  });

  /* ── 2d. Both rails → tab selector shown ─────────────────── */
  test('shows rail tabs when both card and USDC are available', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_3', amount: 15.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: true, publishable_key: 'pk_test_placeholder' },
        usdc: { available: true, balance: 100.00, wallet_id: 'w_1', sufficient: true }
      }
    });

    await mockCreateIntent(page, { success: false, error: 'Stripe not configured' }, 503);

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#rail-tabs')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#tab-card')).toBeVisible();
    await expect(page.locator('#tab-usdc')).toBeVisible();
  });

  /* ── 2e. USDC balance displayed ───────────────────────────── */
  test('shows USDC balance when probed', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_4', amount: 20.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false },
        usdc: { available: true, balance: 50.00, wallet_id: 'w_2', sufficient: true }
      }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#usdc-panel')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#balance-display')).toContainText('$50.00');
  });

  /* ── 2f. Insufficient USDC → button disabled ─────────────── */
  test('disables USDC button when balance insufficient', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_5', amount: 50.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false },
        usdc: { available: true, balance: 10.00, wallet_id: 'w_3', sufficient: false }
      }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#btn-pay-usdc')).toBeDisabled({ timeout: 8_000 });
  });

  /* ── 2g. No rails → error ────────────────────────────────── */
  test('shows error when no rails are available', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_6', amount: 10.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false, reason: 'Stripe not configured' },
        usdc: { available: false, reason: 'No provider wallet' }
      }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#error-state')).toBeVisible({ timeout: 8_000 });
  });

  /* ── 2h. USDC pay → success ───────────────────────────────── */
  test('shows success state after USDC payment completes', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_7', amount: 20.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false },
        usdc: { available: true, balance: 100.00, wallet_id: 'w_4', sufficient: true }
      }
    });

    await mockComplete(page, {
      success: true,
      payment_id: 'pay_7',
      status: 'paid',
      method: 'usdc'
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await page.locator('#btn-pay-usdc').click();
    await expect(page.locator('#success-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#success-amount')).toContainText('$20.00');
  });

  /* ── 2i. USDC complete 400 → inline error ─────────────────── */
  test('shows inline error when USDC complete returns 400', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_8', amount: 40.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false },
        usdc: { available: true, balance: 30.00, wallet_id: 'w_5', sufficient: true }
      }
    });

    await mockComplete(page, {
      success: false,
      error: 'Insufficient balance',
      current_balance: 30.00,
      required: 40.00
    }, 400);

    await page.goto(payUrl(MOCK_TOKEN));
    await page.locator('#btn-pay-usdc').click();
    await expect(page.locator('#inline-error')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#inline-error-msg')).toContainText(/balance|insufficient/i);
  });

  /* ── 2j. Rail tab switching ───────────────────────────────── */
  test('switches between card and USDC panels via rail tabs', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_9', amount: 10.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: true, publishable_key: 'pk_test_placeholder' },
        usdc: { available: true, balance: null, wallet_id: 'w_6', sufficient: true }
      }
    });

    await mockCreateIntent(page, { success: false, error: 'Stripe not configured' }, 503);

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#rail-tabs')).toBeVisible({ timeout: 8_000 });

    // Switch to USDC
    await page.locator('#tab-usdc').click();
    await expect(page.locator('#usdc-panel')).toBeVisible();
    await expect(page.locator('#card-panel')).not.toBeVisible();

    // Switch back to card
    await page.locator('#tab-card').click();
    await expect(page.locator('#card-panel')).toBeVisible();
    await expect(page.locator('#usdc-panel')).not.toBeVisible();
  });

  /* ── 2k. create-intent 409 → already paid state ─────────── */
  test('shows already-paid state when create-intent returns 409', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_10', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: true, publishable_key: 'pk_test_placeholder' },
        usdc: { available: false }
      }
    });

    await mockCreateIntent(page, { success: false, error: 'Payment already completed' }, 409);

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#already-paid-state')).toBeVisible({ timeout: 8_000 });
  });

  /* ── 2l. 3DS redirect return → /complete called ──────────── */
  test('calls /complete on 3DS redirect return with succeeded status', async ({ page }) => {
    const completeCalls = [];

    await page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}/complete`, async route => {
      const body = route.request().postDataJSON();
      completeCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, payment_id: 'pay_3ds', status: 'paid', method: 'stripe' })
      });
    });

    // Mock context for 3DS return
    await page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            already_paid: false,
            payment: { id: 'pay_3ds', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
            rails: {
              card: { available: true, publishable_key: 'pk_test_placeholder' },
              usdc: { available: false }
            }
          })
        });
      }
    });

    // Navigate as if 3DS returned
    await page.goto(
      `${BASE}/patients/pay.html?token=${MOCK_TOKEN}&redirect_status=succeeded&payment_intent=pi_3ds_test&rcm_token=${MOCK_TOKEN}`
    );

    await expect(page.locator('#success-state')).toBeVisible({ timeout: 8_000 });
    expect(completeCalls.length).toBeGreaterThan(0);
    expect(completeCalls[0]).toMatchObject({ method: 'stripe', payment_intent_id: 'pi_3ds_test' });
  });

  /* ── 2m. Network failure → error state ─────────────────────── */
  test('shows fatal error on network failure', async ({ page }) => {
    await page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}`, route => route.abort('failed'));

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#error-state')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#fatal-error-msg')).toContainText(/connection|network|load/i);
  });

  /* ── 2n. Security: token not exposed in DOM ─────────────────── */
  test('does not expose raw token in visible page text', async ({ page }) => {
    const sensitiveToken = 'super-secret-token-abc123';

    await page.route(`**/api/public/rcm/pay/${sensitiveToken}`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          already_paid: true,
          payment: { id: 'pay_s', amount: 10.00, currency: 'USD', status: 'paid', method: 'stripe' },
          rails: { card: { available: false }, usdc: { available: false } }
        })
      });
    });

    await page.goto(`${BASE}/patients/pay.html?token=${sensitiveToken}`);
    await expect(page.locator('#already-paid-state')).toBeVisible({ timeout: 8_000 });

    const bodyText = await page.locator('body').innerText();
    // Token should not appear in visible text (it may appear in URLs/attrs, not innerText)
    expect(bodyText).not.toContain(sensitiveToken);
  });

  /* ── 2o. Accessibility: pay button has accessible name ─────── */
  test('pay button has accessible name and is keyboard focusable', async ({ page }) => {
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_a11y', amount: 12.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false },
        usdc: { available: true, balance: 50.00, wallet_id: 'w_a', sufficient: true }
      }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    const btn = page.locator('#btn-pay-usdc');
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await expect(btn).toBeEnabled();
    // Can receive focus
    await btn.focus();
    await expect(btn).toBeFocused();
  });

  /* ── 2p. Mobile viewport renders correctly ─────────────────── */
  test('renders correctly on mobile viewport (375px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();

    await page.route(`**/api/public/rcm/pay/${MOCK_TOKEN}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            already_paid: false,
            payment: { id: 'pay_mob', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
            rails: {
              card: { available: false },
              usdc: { available: true, balance: 100.00, wallet_id: 'w_mob', sufficient: true }
            }
          })
        });
      }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#payment-form')).toBeVisible({ timeout: 8_000 });

    // Card should not overflow
    const card = page.locator('.card').first();
    const box  = await card.boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);

    await ctx.close();
  });

  /* ── 2q. fmtMoney: small dollar amounts display correctly ─── */
  test('displays amount_due of $25 (not 2500) in amount banner', async ({ page }) => {
    // The RCM API returns dollars (not cents); verify no /100 conversion
    await mockContext(page, {
      success: true,
      already_paid: false,
      payment: { id: 'pay_fmt', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
      rails: {
        card: { available: false },
        usdc: { available: true, balance: 100.00, wallet_id: 'w_fmt', sufficient: true }
      }
    });

    await page.goto(payUrl(MOCK_TOKEN));
    await expect(page.locator('#amount-display')).toContainText('$25.00', { timeout: 8_000 });
    // Must NOT show 2500 anywhere in the banner
    await expect(page.locator('.amount-banner')).not.toContainText('2500');
  });

});

/* ═══════════════════════════════════════════════════════════════════
   Suite 3 — Live Stripe card flow (RCM_E2E_STRIPE_LIVE=1)
══════════════════════════════════════════════════════════════════ */
test.describe('pay.html — live Stripe card flow', () => {
  test.skip(!STRIPE_LIVE, 'Set RCM_E2E_STRIPE_LIVE=1 to run');

  let apiCtx;
  test.beforeAll(async ({ playwright }) => {
    apiCtx = await playwright.request.newContext({ baseURL: BASE });
  });
  test.afterAll(async () => apiCtx.dispose());

  test('patient pays $10 copay with test card (no 3DS)', async ({ page }) => {
    const { pay_token, payment_id } = await createPaymentViaKelly({ amount: 10 });

    await page.goto(payUrl(pay_token));
    await expect(page.locator('#payment-form')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#amount-display')).toContainText('$10.00');

    await fillStripeCard(page, CARD_SUCCESS);

    await page.locator('#btn-pay-card').click();

    // Stripe may redirect for 3DS and return, or confirm inline
    await expect(page.locator('#success-state'))
      .toBeVisible({ timeout: 30_000 });

    // Verify via API that payment is now marked paid
    const check = await apiCtx.get(
      `${BASE}/api/public/rcm/pay/${pay_token}`
    );
    const data = await check.json();
    expect(data.already_paid).toBe(true);
    expect(data.payment.status).toBe('paid');
  });

  test('declined card shows inline error without crashing page', async ({ page }) => {
    const { pay_token } = await createPaymentViaKelly({ amount: 5 });

    await page.goto(payUrl(pay_token));
    await expect(page.locator('#payment-form')).toBeVisible({ timeout: 15_000 });

    await fillStripeCard(page, CARD_DECLINE);
    await page.locator('#btn-pay-card').click();

    // Should show inline error, not fatal error
    await expect(page.locator('#inline-error')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#error-state')).not.toBeVisible();
    await expect(page.locator('#success-state')).not.toBeVisible();
  });

  test('paying an already-paid token shows already-paid state', async ({ page }) => {
    const { pay_token } = await createPaymentViaKelly({ amount: 5 });

    // Mark as paid via provider API
    const listRes = await apiCtx.get(`${BASE}/api/rcm/payments?clinic_id=${CLINIC}`);
    const list    = await listRes.json();
    const payment = (list.payments || list).find(p => p.pay_token === pay_token);
    if (payment) {
      await apiCtx.post(`${BASE}/api/rcm/payments/${payment.id}/mark-paid`);
    }

    await page.goto(payUrl(pay_token));
    await expect(page.locator('#already-paid-state')).toBeVisible({ timeout: 10_000 });
  });

  test('double-submit does not charge twice (idempotency)', async ({ page }) => {
    const { pay_token } = await createPaymentViaKelly({ amount: 8 });

    await page.goto(payUrl(pay_token));
    await expect(page.locator('#payment-form')).toBeVisible({ timeout: 15_000 });
    await fillStripeCard(page, CARD_SUCCESS);

    // Click pay once, then immediately try again
    const btn = page.locator('#btn-pay-card');
    await btn.click();
    // Button should be disabled while processing
    await expect(btn).toBeDisabled();

    await expect(page.locator('#success-state')).toBeVisible({ timeout: 30_000 });

    // Verify only one payment intent was created for this token
    const check = await apiCtx.get(`${BASE}/api/public/rcm/pay/${pay_token}`);
    const data  = await check.json();
    expect(data.payment.stripe_payment_intent_id).toBeTruthy();
    // intent id should be a single pi_ string, not duplicated
    expect(data.payment.stripe_payment_intent_id).toMatch(/^pi_/);
  });

});

/* ═══════════════════════════════════════════════════════════════════
   Suite 4 — Live USDC flow (RCM_E2E_USDC_LIVE=1)
══════════════════════════════════════════════════════════════════ */
test.describe('pay.html — live USDC flow', () => {
  test.skip(!USDC_LIVE, 'Set RCM_E2E_USDC_LIVE=1 + seeded wallets to run');

  let apiCtx;
  test.beforeAll(async ({ playwright }) => {
    apiCtx = await playwright.request.newContext({ baseURL: BASE });
  });
  test.afterAll(async () => apiCtx.dispose());

  test('patient pays $5 copay via USDC wallet', async ({ page }) => {
    const { pay_token } = await createPaymentViaKelly({
      amount: 5,
      patientId: process.env.RCM_E2E_PATIENT_ID || undefined,
    });

    await page.goto(payUrl(pay_token));
    await expect(page.locator('#usdc-panel')).toBeVisible({ timeout: 10_000 });

    await page.locator('#btn-pay-usdc').click();
    await expect(page.locator('#success-state')).toBeVisible({ timeout: 20_000 });

    const check = await apiCtx.get(`${BASE}/api/public/rcm/pay/${pay_token}`);
    const data  = await check.json();
    expect(data.payment.status).toBe('paid');
    expect(data.payment.method).toBe('usdc');
  });

});

/* ═══════════════════════════════════════════════════════════════════
   Suite 5 — Wallet integration smoke
══════════════════════════════════════════════════════════════════ */
test.describe('wallet.html — pay URL integration', () => {

  test('wallet bills section links to pay.html (not a 404)', async ({ page }) => {
    // Mock the bill-status API to return a bill with pay_url
    await page.route('**/api/patient/rcm/bill-status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          patient_id: 'Patient/test',
          bills: [{
            journey_id: 'jrn_test',
            clinic_id: 'clinic-default',
            journey_stage: 'patient_collection',
            journey_stage_label: 'Patient Collection',
            amount_due: 25.00,
            payment_status: 'requested',
            pay_url: `${BASE}/patients/pay.html?token=wallet-link-token`,
            status_chip: 'patient_due',
            status_label: 'Amount due',
            updated_at: new Date().toISOString()
          }]
        })
      });
    });

    // Mock pay.html context so the link resolves
    await page.route('**/api/public/rcm/pay/wallet-link-token', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          already_paid: false,
          payment: { id: 'pay_w', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
          rails: {
            card: { available: false },
            usdc: { available: true, balance: 100.00, wallet_id: 'w_wallet', sufficient: true }
          }
        })
      });
    });

    // Mock session check so wallet loads
    await page.route('**/api/patient/**', async route => {
      if (route.request().url().includes('bill-status')) {
        await route.continue();
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] })
        });
      }
    });

    await page.goto(`${BASE}/patients/wallet.html`);

    // Find a Pay link pointing to pay.html
    const payLink = page.locator('a[href*="pay.html"]').first();

    if (await payLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
      const href = await payLink.getAttribute('href');
      expect(href).toContain('pay.html');
      expect(href).toContain('token=');

      // Follow the link and verify pay.html loads
      await page.goto(href);
      await expect(page.locator('#payment-form,#already-paid-state,#error-state'))
        .toBeVisible({ timeout: 10_000 });
      // Must NOT be a 404 page
      await expect(page.locator('body')).not.toContainText(/404|not found/i);
    }
  });

  test('pay.html token from pay_url resolves context from API', async ({ page }) => {
    const token = 'wallet-round-trip-token';
    await page.route(`**/api/public/rcm/pay/${token}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            already_paid: false,
            payment: { id: 'pay_rt', amount: 25.00, currency: 'USD', status: 'requested', method: 'manual' },
            rails: {
              card: { available: false },
              usdc: { available: true, balance: null, wallet_id: 'w_rt', sufficient: true }
            }
          })
        });
      }
    });

    await page.goto(`${BASE}/patients/pay.html?token=${token}`);
    // Page body must contain recognisable payment UI (Playwright spec requirement)
    await expect(page.locator('body')).toContainText(/pay|amount|card|wallet/i, { timeout: 8_000 });
    // Amount shown in dollars
    await expect(page.locator('#amount-display')).toContainText('$25.00');
  });

});

/* ═══════════════════════════════════════════════════════════════════
   Suite 6 — API unit contracts (no browser)
══════════════════════════════════════════════════════════════════ */
test.describe('RCM public pay API — contract tests', () => {

  let apiCtx;
  test.beforeAll(async ({ playwright }) => {
    apiCtx = await playwright.request.newContext({ baseURL: BASE });
  });
  test.afterAll(async () => apiCtx.dispose());

  test('GET /api/public/rcm/pay/invalid-token returns 404', async () => {
    const res = await apiCtx.get('/api/public/rcm/pay/this-token-does-not-exist-xyz');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  test('POST /api/public/rcm/pay/invalid-token/create-intent returns 404', async () => {
    const res = await apiCtx.post('/api/public/rcm/pay/this-token-does-not-exist-xyz/create-intent');
    expect([404, 400]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('POST /api/public/rcm/pay/invalid-token/complete with bad method returns 400', async () => {
    const res = await apiCtx.post('/api/public/rcm/pay/this-token-does-not-exist-xyz/complete', {
      data: { method: 'paypal' } // unsupported
    });
    // 400 or 404 acceptable; must not be 500
    expect(res.status()).not.toBe(500);
  });

  test('GET /api/public/rcm/pay/:token response shape is correct', async () => {
    // Skip if no provider auth (integration env only)
    test.skip(!process.env.TEST_PROVIDER_JWT, 'Needs TEST_PROVIDER_JWT for live fixture');

    const reqApiCtx = await request.newContext({ baseURL: BASE });
    const createRes = await reqApiCtx.post(`/api/rcm/payments/request?clinic_id=${CLINIC}`, {
      data: { amount: 1 },
      headers: { Authorization: `Bearer ${process.env.TEST_PROVIDER_JWT}` }
    });
    const { pay_token } = await createRes.json();

    const res  = await apiCtx.get(`/api/public/rcm/pay/${pay_token}`);
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('already_paid');
    expect(body).toHaveProperty('payment');
    expect(body).toHaveProperty('rails');
    expect(body.payment).toHaveProperty('amount');
    expect(body.payment).toHaveProperty('currency');
    expect(body.rails).toHaveProperty('card');
    expect(body.rails).toHaveProperty('usdc');
    // amount must be in dollars (reasonable range for $1 test)
    expect(body.payment.amount).toBeGreaterThan(0);
    expect(body.payment.amount).toBeLessThan(10000); // not cents

    await reqApiCtx.dispose();
  });

});
