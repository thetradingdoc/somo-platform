'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  loginProviderViaApi,
  sel
} = require('../helpers/portal-auth.cjs');
const { seedKellyActivityEvent } = require('../helpers/portal-fixtures.cjs');

const db = require('../../../database');

test.describe('04 — Kelly activity feed', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('shows booking activity after seeded event', async ({ page, request }) => {
    const customer = await loginProviderViaApi(request);
    if (!customer) test.skip(true, 'Provider login unavailable');

    const clinicRow = db.db
      .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
      .get(customer.merchant_id);
    const clinicId = clinicRow?.clinic_id;
    if (!clinicId) test.skip(true, 'No clinic for provider');

    seedKellyActivityEvent({
      clinicId,
      eventType: 'appointment_booked',
      payload: { patient_name: 'Kelly E2E Patient', appointment_id: 'appt-e2e-test' }
    });

    await loginViaUi(page, request);
    await page.goto(`${page.url().split('/business')[0]}/business/today.html`, {
      waitUntil: 'domcontentloaded'
    });

    const panel = page.locator(sel.kellyActivity);
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      return await panel.locator('.pp-feed-item, .pp-feed-item--kelly').count();
    }, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(panel.getByText(/Kelly booked/i).first()).toBeVisible();
  });
});
