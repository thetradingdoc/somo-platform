/**
 * Parity with unified-dashboard/littlelab-landing/src/index.js product card CTAs:
 *
 * 1) "Learn more" → handleChatAboutIngredients
 *    - intent=checkout_chat, bridge=1, chat_focus=ingredients (no cart_bootstrap)
 *    - Browse-first / learn shell: ingredient Q&A before cart.
 *
 * 2) Cart / "Checkout in chat" icon → handleStartProductCheckout
 *    - intent=checkout_chat, bridge=1, cart_bootstrap=1
 *    - Checkout shell + auto cart message from Kelly copy (cartBootstrapAssistant).
 *
 * Run (API on 4000):
 *   CHECKOUT_E2E_BASE_URL=http://127.0.0.1:4000 npx playwright test e2e/landing-cta-entry-flows.spec.cjs
 */
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}
process.env.DB_PATH = path.join(__dirname, '..', 'middleware-dev.db');

const { test, expect } = require('@playwright/test');
const { sendWithRetry } = require('./checkout-ui-helpers');

const base = (process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

test.describe('Landing CTA entry → checkout-chat (full UI)', () => {
  test.beforeEach(async ({ page }) => {
    const apiBase = base;
    await page.addInitScript((b) => {
      try {
        window.API_BASE = b;
        sessionStorage.clear();
        localStorage.setItem('patient_session_id', 'e2e_landing_cta_guest');
        localStorage.removeItem('cc_phase3_enabled');
      } catch (_) {}
    }, apiBase);
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      await route.abort();
    });
  });

  test('Learn more: ingredients browse-first (learn shell, then agent reply)', async ({ page, request }) => {
    test.setTimeout(180000);
    const products = await request.get(`${base}/api/public/products`);
    expect(products.ok()).toBeTruthy();
    const payload = await products.json();
    const product = (payload?.products || [])[0];
    expect(product).toBeTruthy();

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      bridge: '1',
      chat_focus: 'ingredients',
      product_id: product.id,
      provider_id: product.merchant_id || product.provider_id,
      product_name: String(product.name || product.title || product.displayName || 'Product')
    });

    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#productTitle')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('body')).toHaveClass(/mode-learn/);
    await expect(page.locator('#ccCheckoutDockProgress')).toBeHidden();

    const placeholder = await page.locator('#composer').getAttribute('placeholder');
    expect(placeholder).toMatch(/Ask about|routine/i);

    await expect(page.locator('#chatLog')).not.toContainText('I added this to your cart', { timeout: 8000 });

    const lenBefore = await page.locator('#chatLog').innerText();
    await sendWithRetry(page, 'What are the main active ingredients in this product?');
    await page.waitForFunction(
      (prev) => {
        const t = document.querySelector('#chatLog')?.innerText || '';
        return t.length > (prev || '').length + 40;
      },
      lenBefore,
      { timeout: 120000 }
    );
  });

  test('Checkout in chat: cart bootstrap (checkout shell + bootstrap line + agent after confirm)', async ({
    page,
    request
  }) => {
    test.setTimeout(180000);
    const products = await request.get(`${base}/api/public/products`);
    expect(products.ok()).toBeTruthy();
    const payload = await products.json();
    const product = (payload?.products || [])[0];
    expect(product).toBeTruthy();

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      bridge: '1',
      cart_bootstrap: '1',
      product_id: product.id,
      provider_id: product.merchant_id || product.provider_id,
      product_name: String(product.name || product.title || product.displayName || 'Product')
    });

    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#productTitle')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('body')).toHaveClass(/mode-checkout/);
    await expect(page.locator('#ccCheckoutDockProgress')).toBeVisible();
    await expect(page.locator('#composerEyebrow')).toContainText(/Checkout/i, { timeout: 15000 });

    await expect(page.locator('#chatLog')).toContainText(/added.*cart|Confirm product/i, { timeout: 60000 });

    const lenBefore = await page.locator('#chatLog').innerText();
    await sendWithRetry(page, 'Yes, that looks right — please continue.');
    await page.waitForFunction(
      (prev) => {
        const t = document.querySelector('#chatLog')?.innerText || '';
        return t.length > (prev || '').length + 40;
      },
      lenBefore,
      { timeout: 120000 }
    );
  });
});
