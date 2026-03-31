const { test, expect } = require('@playwright/test');

const base = (process.env.CHECKOUT_E2E_BASE_URL || '').replace(/\/$/, '');

test.describe('checkout-chat learn vs checkout mode', () => {
  test.skip(!base, 'Set CHECKOUT_E2E_BASE_URL (e.g. http://127.0.0.1:8765)');

  test('learn_more shows learn shell (cart/stepper de-emphasized)', async ({ page }) => {
    const productId = 'prod-retinol-peptide-night-serum';
    const providerId = 'merchant_c3d547a10f43eeec';

    await page.addInitScript(() => {
      try {
        localStorage.setItem('patient_session_id', 'e2e-checkout-modes');
      } catch (_) {}
    });

    await page.route('**/api/public/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          products: [
            {
              id: productId,
              merchant_id: providerId,
              name: 'Retinol Brightening Night Serum',
              price: 29.99,
              image_url: '/images/products/retinol-brightening-night-serum.png'
            }
          ],
          prescriptions: [],
          count: 1,
          provider_id: providerId,
          merchant_id: providerId
        })
      });
    });

    const q = new URLSearchParams({
      intent: 'learn_more',
      phase3: '1',
      product_id: productId,
      provider_id: providerId,
      bridge: '0',
      cart_bootstrap: '0',
      product_name: 'Retinol Brightening Night Serum'
    });

    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`);
    await expect(page.locator('#productTitle')).toContainText('Retinol Brightening Night Serum');
    await expect(page.locator('body')).toHaveClass(/mode-learn/);
    await expect(page.locator('#ccCheckoutDockProgress')).toHaveClass(/hidden/);
  });

  test('checkout_chat shows checkout shell', async ({ page }) => {
    const productId = 'prod-retinol-peptide-night-serum';
    const providerId = 'merchant_c3d547a10f43eeec';

    await page.addInitScript(() => {
      try {
        localStorage.setItem('patient_session_id', 'e2e-checkout-modes');
      } catch (_) {}
    });

    await page.route('**/api/public/products**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          products: [
            {
              id: productId,
              merchant_id: providerId,
              name: 'Retinol Brightening Night Serum',
              price: 29.99,
              image_url: '/images/products/retinol-brightening-night-serum.png'
            }
          ],
          prescriptions: [],
          count: 1,
          provider_id: providerId,
          merchant_id: providerId
        })
      });
    });

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      product_id: productId,
      provider_id: providerId,
      bridge: '0',
      cart_bootstrap: '0',
      product_name: 'Retinol Brightening Night Serum'
    });

    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`);
    await expect(page.locator('body')).toHaveClass(/mode-checkout/);
    await expect(page.locator('#ccCheckoutDockProgress')).not.toHaveClass(/hidden/);
  });
});
