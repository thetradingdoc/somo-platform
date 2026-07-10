'use strict';

/**
 * Onboarding mobile viewport smoke — FD-143.
 */
const { test, expect } = require('@playwright/test');
const { middlewareUp, API_BASE } = require('./helpers/portal-auth.cjs');
const sel = require('./helpers/portal-selectors.cjs');
const {
  createPendingInvite,
  createConvertedLead,
  loginProvider
} = require('./helpers/onboarding-fixtures.cjs');

test.describe('@onboarding Mobile auth shells (FD-143)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  async function assertNoHorizontalOverflow(page) {
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth > el.clientWidth + 1;
    });
    expect(overflow).toBe(false);
  }

  test('login shell fits 390px viewport', async ({ page }) => {
    await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(sel.loginEmail)).toBeVisible();
    await expect(page.locator('.sfd-device-card')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('invite shell fits 390px viewport', async ({ page, request }) => {
    const { invite } = createPendingInvite();
    // Confirm invite is readable via the running server (same DB) before asserting UI.
    const probe = await request.get(`/api/invites/${encodeURIComponent(invite.code)}`);
    expect(probe.ok(), `invite probe ${probe.status()}`).toBeTruthy();
    await page.goto(`${API_BASE}/business/invite.html?code=${encodeURIComponent(invite.code)}`, {
      waitUntil: 'networkidle'
    });
    await expect(page.locator('#inviteForm')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sfd-device-card')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('voice-setup step 1 stepper visible at 390px', async ({ page, request }) => {
    const { email, password } = await createConvertedLead();
    // Retry login once — CI can briefly 429 after earlier onboarding suites.
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await loginProvider(page, request, { email, password });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!/too many/i.test(String(err?.message || ''))) throw err;
        await page.waitForTimeout(1500 * (attempt + 1));
      }
    }
    if (lastErr) throw lastErr;

    await page.goto(`${API_BASE}/business/voice-setup.html?step=1`, { waitUntil: 'networkidle' });
    await expect(page.locator('#setupPracticeName')).toBeVisible();
    await expect(page.locator('#setupTitle')).toBeVisible();
    await expect(page.locator('#setupNext1')).toBeVisible();
  });
});
