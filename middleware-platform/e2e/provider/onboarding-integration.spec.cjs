'use strict';

/**
 * @integration Onboarding with live API state (minimal route mocks).
 * External vendors (Google calendar list, Retell) are not stubbed — only auth + DB seed.
 */
const { test, expect } = require('@playwright/test');
const { middlewareUp, API_BASE } = require('./helpers/portal-auth.cjs');
const sel = require('./helpers/portal-selectors.cjs');
const {
  createConvertedLead,
  loginProvider,
  waitVoiceSetupReady
} = require('./helpers/onboarding-fixtures.cjs');

test.describe('@integration Onboarding live state', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('live onboarding blockers API drives go-live checklist', async ({ page, request }) => {
    const { email, password } = await createConvertedLead();
    await loginProvider(page, request, { email, password });

    const blockersRes = await request.get(`${API_BASE}/api/voice-agent/onboarding/blockers`, {
      headers: { Cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') }
    });
    expect(blockersRes.ok()).toBeTruthy();
    const blockersBody = await blockersRes.json();
    expect(blockersBody.success).toBe(true);
    expect(Array.isArray(blockersBody.blockers)).toBe(true);

    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });
    await expect(page.locator(sel.onboardingChecklist).or(page.locator('#goLiveChecklist'))).toBeVisible({
      timeout: 20_000
    });
  });

  test('voice-setup step 1 loads real customer settings without API stubs', async ({ page, request }) => {
    const { email, password } = await createConvertedLead();
    await loginProvider(page, request, { email, password });

    await page.goto(`${API_BASE}/business/voice-setup.html?step=1`, { waitUntil: 'networkidle' });
    await waitVoiceSetupReady(page);
    await expect(page.locator('#setupPracticeName')).not.toHaveValue('');
    await expect(page.locator('#setupTransferNumber')).toBeVisible();
  });
});
