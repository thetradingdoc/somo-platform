'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  loginProviderViaApi,
  sel
} = require('../helpers/portal-auth.cjs');
const { seedAppointmentViaApi, tomorrowIso } = require('../helpers/portal-fixtures.cjs');

test.describe('03 — Calendar CRUD', () => {
  let customer;
  let appointmentId;

  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    customer = await loginProviderViaApi(request);
    if (!customer) test.skip(true, 'Provider credentials unavailable');
  });

  test.beforeEach(async ({ page, request }) => {
    await loginViaUi(page, request);
    const appt = await seedAppointmentViaApi(request, customer, {
      date: tomorrowIso(),
      time: '11:00',
      patient_name: `Cal E2E ${Date.now()}`
    });
    appointmentId = appt.id || appt.appointment_id;
  });

  test('open calendar, view appointment, cancel with in-modal reason', async ({ page }) => {
    await gotoProviderPage(page, `calendar.html?id=${encodeURIComponent(appointmentId)}`);
    await expect(page.locator(sel.calendarRoot)).toBeVisible({ timeout: 20_000 });

    const modal = page.locator('#detailsModal');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await page.locator(sel.calCancelReason).fill('Patient requested cancellation — E2E test');
    await page.locator(sel.calModalCancel).click();

    await expect(page.locator(sel.calActionError)).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await expect(modal).toBeHidden({ timeout: 10_000 });
  });
});
