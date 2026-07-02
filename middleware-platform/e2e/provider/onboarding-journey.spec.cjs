'use strict';

/**
 * Playwright onboarding e2e (fd4-fe-p1-playwright) — invite → voice-setup step 1.
 */
const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  API_BASE
} = require('./helpers/portal-auth.cjs');

test.describe('@onboarding Provider onboarding journey', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('logged-in provider reaches voice agent or setup wizard', async ({ page, request }) => {
    await loginViaUi(page, request);
    await page.goto(`${API_BASE}/business/voice-setup.html?step=1`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.url(), { timeout: 20_000 })
      .toMatch(/voice-setup\.html|agent\.html/);
    const onSetup = page.url().includes('voice-setup');
    if (onSetup) {
      await expect(page.locator('#setupGreeting, #setupTitle, .va-textarea').first()).toBeVisible({
        timeout: 15_000
      });
    } else {
      await expect(page.locator('#vaPhone, #vaToggle').first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('today dashboard shows ROI panel when loaded', async ({ page, request }) => {
    await loginViaUi(page, request);
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#ppRoiPanel')).toBeVisible({ timeout: 20_000 });
  });
});
