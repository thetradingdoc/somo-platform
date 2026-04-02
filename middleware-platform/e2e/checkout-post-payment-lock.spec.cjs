/**
 * Ensures payment bubble can be locked (no live card mount) via test hook.
 * Requires API for a minimal product load; uses cc_test_hooks=1.
 *
 *   CHECKOUT_E2E_BASE_URL=http://127.0.0.1:4000 npx playwright test e2e/checkout-post-payment-lock.spec.cjs
 */
const { test, expect } = require('@playwright/test');

const base = (process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

test.describe('Post-payment lock hook', () => {
  test('lockPaymentBubbleAfterSuccess clears #ccStripePaymentMount', async ({ page, request }) => {
    test.setTimeout(120000);
    const products = await request.get(`${base}/api/public/products`);
    expect(products.ok()).toBeTruthy();
    const payload = await products.json();
    const product = (payload?.products || [])[0];
    expect(product).toBeTruthy();

    await page.addInitScript((apiBase) => {
      try {
        window.API_BASE = apiBase;
        sessionStorage.clear();
        localStorage.setItem('patient_session_id', 'e2e_postpay_lock');
      } catch (_) {}
    }, base);

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      bridge: '1',
      cart_bootstrap: '1',
      product_id: product.id,
      provider_id: product.merchant_id || product.provider_id,
      product_name: String(product.name || product.title || 'Product'),
      cc_test_hooks: '1'
    });

    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#productTitle')).toBeVisible({ timeout: 45000 });

    const cleared = await page.evaluate(() => {
      const log = document.getElementById('chatLog');
      if (!log) return { ok: false, reason: 'no chatLog' };
      const bubble = document.createElement('div');
      bubble.className = 'cc-msg cc-msg-assistant';
      bubble.innerHTML = '<div id="ccStripePaymentMount"></div>';
      log.appendChild(bubble);
      const hook = window.__CC_CHECKOUT_TEST__;
      if (!hook || typeof hook.lockPaymentBubbleAfterSuccess !== 'function') {
        return { ok: false, reason: 'no test hook' };
      }
      hook.lockPaymentBubbleAfterSuccess();
      return { ok: !document.getElementById('ccStripePaymentMount'), lockedText: bubble.innerText || '' };
    });

    expect(cleared.ok, cleared.reason || '').toBeTruthy();
    expect(String(cleared.lockedText || '')).toMatch(/Payment complete|security/i);
  });
});
