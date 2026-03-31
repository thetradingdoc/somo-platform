/**
 * Optional E2E: hero must not stay on "Loading…" when catalog returns 429 if URL has product_name.
 *
 * Prerequisites:
 *   cd middleware-platform && npx playwright install chromium
 *   Start API + static host so CHECKOUT_E2E_BASE_URL serves `unified-dashboard/patients/`.
 *
 * Run:
 *   CHECKOUT_E2E_BASE_URL=http://127.0.0.1:4000 npx playwright test
 */
const { test, expect } = require('@playwright/test');

const base = (process.env.CHECKOUT_E2E_BASE_URL || '').replace(/\/$/, '');

test.describe('checkout hero (catalog degraded)', () => {
  test.skip(!base, 'Set CHECKOUT_E2E_BASE_URL (e.g. http://127.0.0.1:4000)');

  test('title uses product_name and is not Loading… after 429', async ({ page }) => {
    await page.route('**/api/public/products**', (route) => {
      route.fulfill({
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, error: 'rate_limited' }),
      });
    });

    const q = new URLSearchParams({
      product_id: 'prod-test-degraded',
      product_name: 'Serum Test Degraded',
      source: 'landing',
      intent: 'checkout_chat',
      bridge: '0',
    });
    await page.goto(
      `${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`
    );

    await expect(page.locator('#productTitle')).not.toHaveText('Loading…', {
      timeout: 20_000,
    });
    await expect(page.locator('#productTitle')).toContainText('Serum Test Degraded');
    await expect(page.getByRole('button', { name: /Retry catalog/i })).toBeVisible();
  });
});
