'use strict';

/**
 * Serial critical path: login → calendar → revenue → agent
 */
const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  loginProviderViaApi,
  API_BASE,
  sel
} = require('./helpers/portal-auth.cjs');
const { seedAppointmentViaApi, tomorrowIso } = require('./helpers/portal-fixtures.cjs');

test.describe.configure({ mode: 'serial' });

test.describe('@critical Provider portal journey', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('login → today dashboard', async ({ page, request }) => {
    await loginViaUi(page, request);
    await expect(page.locator(sel.scheduleList)).toBeVisible({ timeout: 20_000 });
  });

  test('calendar loads with seeded appointment', async ({ page, request }) => {
    const customer = await loginProviderViaApi(request);
    test.skip(!customer, 'No provider');
    const appt = await seedAppointmentViaApi(request, customer, { date: tomorrowIso(), time: '09:30' });
    await loginViaUi(page, request);
    await gotoProviderPage(page, `calendar.html?id=${encodeURIComponent(appt.id || appt.appointment_id)}`);
    await expect(page.locator(sel.calendarRoot)).toBeVisible({ timeout: 20_000 });
  });

  test('revenue payments tab', async ({ page, request }) => {
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'revenue.html?tab=payments');
    await expect(page.locator('#ppSidebarNav')).toBeVisible();
  });

  test('agent page toggle or voice setup', async ({ page, request }) => {
    await loginViaUi(page, request);
    await page.goto(`${API_BASE}/business/agent.html`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.url(), { timeout: 20_000 })
      .toMatch(/agent\.html|voice-setup\.html/);
    if (page.url().includes('voice-setup')) {
      await expect(page.getByRole('heading', { name: /practice|voice|setup|agent/i })).toBeVisible({
        timeout: 15_000
      });
    } else {
      await expect(page.locator(sel.agentToggle)).toBeVisible({ timeout: 15_000 });
    }
  });
});
