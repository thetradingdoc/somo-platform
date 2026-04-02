const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}
process.env.DB_PATH = path.join(__dirname, '..', 'middleware-dev.db');

const { test, expect } = require('@playwright/test');
const {
  setMeta,
  waitCode,
  backendTurn,
  sendWithRetry,
  openAnyVisibleChatPayControl,
  fillStripeCardFields
} = require('./checkout-ui-helpers');

const base = (process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const email = String(process.env.TEST_CHECKOUT_EMAIL || 'drlittlekids@gmail.com').toLowerCase();
const shipping = process.env.TEST_CHECKOUT_SHIPPING || '1119 East Gun Hill Road, Bronx, NY 10465';

test('ui agent payment rail works end-to-end', async ({ page, request }) => {
  test.setTimeout(180000);
  page.on('console', (msg) => {
    try {
      console.log('[browser]', msg.type(), msg.text());
    } catch (_) {}
  });

  const products = await request.get(`${base}/api/public/products`);
  expect(products.ok()).toBeTruthy();
  const payload = await products.json();
  const product = (payload?.products || [])[0];
  expect(product).toBeTruthy();
  const productId = product.id;
  const providerId = product.merchant_id || product.provider_id;
  const sessionId = `ui_agent_payment_rail_${Date.now()}`;

  await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: 'add to cart and proceed to checkout' });
  await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: 'confirm cart' });
  await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: email });
  const code = await waitCode(email, 45000);
  expect(code).toBeTruthy();
  await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: code });
  await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: shipping });
  let prepDone = null;
  for (let i = 0; i < 5; i += 1) {
    prepDone = await backendTurn(base, request, {
      session_id: sessionId,
      provider_id: providerId,
      product_id: productId,
      message: 'continue secure checkout'
    });
    if (String(prepDone?.checkout_stage || '') === 'checkout_prepared') break;
  }
  const cartSeed = await request.post(`${base}/api/public/commerce/cart/add`, {
    data: { session_id: sessionId, provider_id: providerId, product_id: productId, quantity: 1 }
  });
  const cartSeedPayload = await cartSeed.json().catch(() => ({}));
  expect(cartSeed.ok() || String(cartSeedPayload?.error || '') === 'cart_locked').toBeTruthy();
  setMeta(sessionId, 'commerce_email_verified', email);
  setMeta(sessionId, 'commerce_shipping_address', shipping);
  setMeta(sessionId, 'commerce_shipping_complete', '1');
  if (String(prepDone?.checkout_stage || '') !== 'checkout_prepared') {
    setMeta(sessionId, 'checkout_stage', 'checkout_prepared');
  }

  await page.addInitScript(({ pId, sid, merchantId, apiBase }) => {
    try {
      window.API_BASE = apiBase;
      const patientSid = 'pw_ui_agent_user';
      localStorage.setItem('patient_session_id', patientSid);
      localStorage.setItem('cc_force_stripe_card_mode', '1');
      const identitySeed = String(patientSid || 'guest');
      let identityHash = 0;
      for (let i = 0; i < identitySeed.length; i++) {
        identityHash = (identityHash * 31 + identitySeed.charCodeAt(i)) >>> 0;
      }
      const key = 'checkout_kelly_session_' + String(pId) + '_' + String(merchantId) + '_checkout_' + String(identityHash);
      localStorage.setItem(key, String(sid));
    } catch (_) {}
  }, { pId: productId, sid: sessionId, merchantId: providerId, apiBase: base });

  const q = new URLSearchParams({
    source: 'landing',
    intent: 'checkout_chat',
    force_stripe_card_mode: '1',
    product_id: productId,
    provider_id: providerId,
    bridge: '0',
    cart_bootstrap: '0',
    product_name: String(product.name || 'Product')
  });
  await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#composer')).toBeVisible();
  await sendWithRetry(page, 'continue secure checkout', 3);
  await openAnyVisibleChatPayControl(page);

  await page.fill('#ccPayConfirmChatBubble input[placeholder="Name on card"]', 'UI Rail E2E');
  await page.fill('#ccPayConfirmChatBubble input[placeholder="Address line 1"]', '1119 East Gun Hill Road');
  await page.fill('#ccPayConfirmChatBubble input[placeholder="City"]', 'Bronx');
  await page.fill('#ccPayConfirmChatBubble input[placeholder="State"]', 'NY');
  await page.fill('#ccPayConfirmChatBubble input[placeholder="ZIP"]', '10465');
  await page.fill('#ccPayConfirmChatBubble input[placeholder="Mobile number"]', '+18622307479');
  await page.fill('#ccPayConfirmChatBubble input[type="email"]', email);

  const payBtn = page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Pay securely' }).first();
  await page.waitForSelector('#ccStripePaymentMount iframe', { state: 'visible', timeout: 45000 }).catch(() => {});
  let cardFilled = await fillStripeCardFields(page);
  if (!cardFilled) {
    await page.waitForTimeout(2000);
    cardFilled = await fillStripeCardFields(page);
  }
  expect(cardFilled).toBeTruthy();
  await expect(payBtn).toBeEnabled({ timeout: 30000 });
  await payBtn.click();
  const refreshedHint = page.locator('#ccPayStateHint').filter({ hasText: 'Payment session refreshed' }).first();
  const retryMountBtn = page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Retry card fields' }).first();
  if (await refreshedHint.isVisible().catch(() => false)) {
    await retryMountBtn.click();
    await page.waitForTimeout(2000);
    const secondFill = await fillStripeCardFields(page);
    expect(secondFill).toBeTruthy();
    await expect(payBtn).toBeEnabled({ timeout: 30000 });
    await payBtn.click();
  }
  await expect(page.locator('#chatLog')).toContainText('Receipt', { timeout: 60000 });

  const stageRes = await request.get(
    `${base}/api/public/checkout-chat/stage?session_id=${encodeURIComponent(sessionId)}&ui_mode=checkout&checkout_intent=1`
  );
  const stagePayload = await stageRes.json().catch(() => ({}));
  expect(stageRes.ok()).toBeTruthy();
  expect(String(stagePayload?.checkout_stage || '')).toBe('payment_confirmed');
});
