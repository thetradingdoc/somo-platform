'use strict';

/**
 * Doctor portal E2E — FD-226, FD-416.
 */
const { test, expect } = require('@playwright/test');
const { middlewareUp, API_BASE } = require('./helpers/portal-auth.cjs');
const { createDoctorPortalProvider, loginProvider } = require('./helpers/onboarding-fixtures.cjs');

test.describe('@doctor-portal Doctor portal screens', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('Today shows voice KPI row', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#kpiRow')).toContainText(/Calls today/i);
    await expect(page.locator('#ppSyncCard')).toBeVisible();
  });

  test('Agent shows sfd nameplate', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await page.goto(`${API_BASE}/business/agent.html`, { waitUntil: 'networkidle' });
    await page.waitForURL(/agent\.html/, { timeout: 20_000 });
    await expect(page.locator('[data-testid="agent-nameplate"] .sfd-nameplate')).toBeVisible({
      timeout: 20_000
    });
  });

  test('FD-416: pause Kelly shows transfer promise (stubbed status)', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await page.route('**/api/voice-agent/settings**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            settings: {
              enabled: true,
              transfer_number: '+12025550199',
              greeting: 'Hello',
              business_hours: { mon: '09:00-17:00' }
            }
          })
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/voice-agent/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          nameplate: 'PAUSED',
          label: 'PAUSED',
          enabled: false,
          transfer_number: '+12025550199'
        })
      });
    });
    await page.goto(`${API_BASE}/business/agent.html`, { waitUntil: 'networkidle' });
    await page.waitForURL(/agent\.html/, { timeout: 20_000 });
    await expect(page.locator('#vaTransferPromise')).toContainText('+12025550199', { timeout: 15_000 });
    await expect(page.locator('#vaStatusNameplate .sfd-nameplate--paused')).toBeVisible();
  });

  test('FD-416: real toggle pause shows transfer promise', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await request.patch(`${API_BASE}/api/voice-agent/settings`, {
      data: {
        enabled: true,
        transfer_number: '+12025550199',
        greeting: 'Thank you for calling.'
      }
    });
    await page.goto(`${API_BASE}/business/agent.html`, { waitUntil: 'networkidle' });
    await page.waitForURL(/agent\.html/, { timeout: 20_000 });
    await expect(page.locator('#vaToggle')).toBeVisible({ timeout: 15_000 });
    const toggleOn = await page.locator('#vaToggle').evaluate((el) => el.classList.contains('on'));
    if (toggleOn) {
      await page.locator('#vaToggle').click();
      await page.waitForResponse(
        (resp) => resp.url().includes('/api/kelly/toggle') && resp.request().method() === 'PATCH',
        { timeout: 15_000 }
      ).catch(() => {});
    }
    await expect(page.locator('#vaTransferPromise')).toContainText('+12025550199', { timeout: 20_000 });
  });

  test('Calls detail renders timeline table', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await page.route('**/api/customer/dashboard/calls**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          calls: [
            {
              call_id: 'call_e2e_1',
              direction: 'inbound',
              status: 'completed',
              created_at: new Date().toISOString(),
              disposition: 'booked'
            }
          ]
        })
      });
    });
    await page.route('**/api/kelly/calls/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          call_summary: { caller_label: 'E2E Caller', eligibility_status: 'verified' },
          timeline: [
            { at: new Date().toISOString(), label: 'Kelly answered' },
            { at: new Date().toISOString(), label: 'Insurance verified' }
          ]
        })
      });
    });
    await page.goto(`${API_BASE}/business/calls.html`, { waitUntil: 'networkidle' });
    await page.locator('.sfd-call-card').first().click();
    await expect(page.locator('.sfd-timeline-table')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.sfd-timeline-table')).toContainText('Kelly answered');
  });

  test('Today celebration when LIVE and no blockers', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await page.route('**/api/voice-agent/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, nameplate: 'LIVE', label: 'LIVE', enabled: true })
      });
    });
    await page.route('**/api/voice-agent/onboarding**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          onboarding_state: 'voice_setup_complete',
          destination: {
            path: '/business/today.html',
            blockers: [],
            checklist: [
              { id: 'voice-setup', label: 'Voice setup', done: true },
              { id: 'forward-line', label: 'Forward line', done: true },
              { id: 'test-call', label: 'Test call', done: true },
              { id: 'shadow-week', label: 'Shadow week', done: true },
              { id: 'pms-manual', label: 'PMS', done: true },
              { id: 'kelly-on', label: 'Kelly on', done: true }
            ]
          }
        })
      });
    });
    await page.goto(`${API_BASE}/business/today.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#ppOnboardingChecklistCelebrate')).toContainText(/ready for live calls/i, {
      timeout: 20_000
    });
  });

  test('Settings has Connected Accounts and Kelly tabs', async ({ page, request }) => {
    const { email, password } = await createDoctorPortalProvider();
    await loginProvider(page, request, { email, password });
    await page.goto(`${API_BASE}/business/settings.html#connected`, { waitUntil: 'networkidle' });
    await expect(page.locator('#settings-tab-connected')).toBeVisible();
    await expect(page.locator('#connectedAccountsMount')).toBeVisible({ timeout: 15_000 });
    await page.locator('#settings-tab-kelly').click();
    await expect(page.locator('#kellySettingsMount')).toBeVisible({ timeout: 15_000 });
  });
});
