'use strict';

/**
 * Onboarding E2E — FD-412 through FD-415.
 */
const { test, expect } = require('@playwright/test');
const { middlewareUp, API_BASE } = require('./helpers/portal-auth.cjs');
const sel = require('./helpers/portal-selectors.cjs');
const {
  createPendingInvite,
  acceptInviteAndSeedPage,
  createConvertedLead,
  setOnboardingWizardStep,
  loginProvider,
  waitWizardStep,
  waitVoiceSetupReady,
  stubVoiceSetupApis,
  stubCalendarApis,
  completeVoiceSetupWizard
} = require('./helpers/onboarding-fixtures.cjs');

test.describe('@onboarding Provider onboarding journey', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('FD-412: invite accept → voice-setup → go-live checklist', async ({ page, request }) => {
    const password = 'TestPass123!';
    const { invite } = createPendingInvite();
    await acceptInviteAndSeedPage(page, request, invite.code, { password });

    await stubVoiceSetupApis(page);
    await page.goto(`${API_BASE}/business/voice-setup.html?step=1`, { waitUntil: 'networkidle' });
    await completeVoiceSetupWizard(page);
    await page.locator('#setupFinish').click();

    await page.waitForURL(/today\.html/, { timeout: 30_000 });
    await expect(page.locator(sel.onboardingChecklist)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid^="onboard-"]').first()).toBeVisible();
  });

  test('FD-413: login redirects incomplete onboarding to voice-setup step', async ({ page, request }) => {
    const { email, password, customerId } = await createConvertedLead();
    setOnboardingWizardStep(customerId, 4);

    await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator(sel.loginEmail).fill(email);
    await page.locator(sel.loginPassword).fill(password);
    await page.locator(sel.loginSubmit).click();

    await page.waitForURL(/voice-setup\.html\?step=4/, { timeout: 30_000 });
  });

  test('FD-414: convert lead provisions tenant → login → voice-setup', async ({ page, request }) => {
    const { email, password } = await createConvertedLead();

    await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator(sel.loginEmail).fill(email);
    await page.locator(sel.loginPassword).fill(password);
    await page.locator(sel.loginSubmit).click();

    await page.waitForURL(/voice-setup\.html/, { timeout: 30_000 });
    await expect(page.locator('#setupPracticeName')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#setupEyebrow')).toContainText(/Step 2 of 7/i);
  });

  test('FD-415: calendar picker renders after mocked Google connect', async ({ page, request }) => {
    const { email, password } = await createConvertedLead();
    await loginProvider(page, request, { email, password });

    let selectPayload = null;
    await stubVoiceSetupApis(page);
    await stubCalendarApis(page, email, {
      onSelect: (payload) => {
        selectPayload = payload;
      }
    });

    await page.goto(`${API_BASE}/business/voice-setup.html?step=1`, { waitUntil: 'networkidle' });
    await waitVoiceSetupReady(page);
    await page.locator('#setupPracticeName').fill('E2E Practice');
    await page.locator('#setupTransferNumber').fill('+12025550100');
    await page.locator('#setupClinicEmail').fill('frontdesk@e2e.example.com');
    await page.locator('#setupNext1').click();
    await waitWizardStep(page, 2);

    await expect(page.locator('#setupCalendarPick')).toBeVisible({ timeout: 20_000 });
    await page.locator('#setupCalendarPick').selectOption('scheduling');
    await expect.poll(() => selectPayload?.calendar_id).toBe('scheduling');
    await page.locator('#setupNext2').click();
    await expect(page.locator('#setupGreeting')).toBeVisible({ timeout: 15_000 });
  });

  test('FD-108: preview live_opener matches DOM on voice-setup step 3', async ({ page, request }) => {
    const liveText = 'Thank you for calling E2E Dental. This is Kelly, your AI assistant.';
    const { email, password } = await createConvertedLead();
    await loginProvider(page, request, { email, password });

    await stubVoiceSetupApis(page, { previewText: liveText });
    await page.goto(`${API_BASE}/business/voice-setup.html?step=1`, { waitUntil: 'networkidle' });
    await completeVoiceSetupWizard(page, { throughStep: 3, previewText: liveText });
  });

  test('today dashboard shows go-live checklist when hash present', async ({ page, request }) => {
    const { email, password } = await createConvertedLead();
    await loginProvider(page, request, { email, password });

    await page.goto(`${API_BASE}/business/today.html#go-live-checklist`, { waitUntil: 'networkidle' });
    await expect(page.locator(sel.onboardingChecklist)).toBeVisible({ timeout: 30_000 });
  });
});
