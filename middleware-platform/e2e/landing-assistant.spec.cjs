/**
 * Skin & Care landing assistant (voice-first overlay + chat).
 *
 * Prerequisites:
 *   - Middleware running (default http://127.0.0.1:4000)
 *   - LittleLab production build so GET / serves the React app:
 *       cd unified-dashboard/littlelab-landing && npm install && npm run build
 *
 * Run:
 *   LANDING_E2E_BASE_URL=http://127.0.0.1:4000 npm run test:e2e-landing-assistant
 *
 * The assistant API is mocked so the test does not require LLM keys or clinic data.
 */
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const { test, expect } = require('@playwright/test');

const base = (process.env.LANDING_E2E_BASE_URL || process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);

test.describe('LittleLab landing assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      await route.abort();
    });
    await page.route('**/api/public/landing-assistant/turn', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, body: 'Method Not Allowed' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          success: true,
          reply: 'E2E mock: moisturizer and SPF help dry skin. This is not medical advice.',
          session_id: 'playwright-landing-session',
          toolsUsed: []
        })
      });
    });
  });

  test('opens assistant from Start Analysis and receives mocked assistant reply in chat', async ({ page }) => {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    expect(title, 'Build littlelab-landing so GET / serves the app (see file header).').not.toContain('DocLittle API');

    await expect(page.locator('main.page')).toBeVisible({ timeout: 20000 });

    await page.getByRole('link', { name: 'Start Analysis' }).first().click();

    const dialog = page.getByRole('dialog', { name: /Skin and Care assistant — voice/i });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator('.axv-mic-hero')).toBeVisible();
    await expect(dialog.locator('.axv-dock')).toBeVisible();

    await dialog.getByRole('button', { name: /Open chat/i }).click();
    await expect(page.getByRole('dialog', { name: /Skin and Care assistant — chat/i })).toBeVisible({ timeout: 10000 });
    const chatDialog = page.getByRole('dialog', { name: /Skin and Care assistant — chat/i });

    await chatDialog.locator('.axc-input').fill('What helps dry skin?');
    await chatDialog.getByRole('button', { name: 'Send' }).click();

    await expect(chatDialog.locator('.axc-bubble--assistant').last()).toContainText(/E2E mock/i, { timeout: 20000 });
  });
});
