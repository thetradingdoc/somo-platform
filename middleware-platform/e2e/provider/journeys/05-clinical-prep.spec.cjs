'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  loginProviderViaApi,
  sel
} = require('../helpers/portal-auth.cjs');
const { seedAppointmentViaApi, seedTriageForAppointment, tomorrowIso } = require('../helpers/portal-fixtures.cjs');

test.describe('05 — Clinical prep panel', () => {
  test('calendar clinical tab shows prep or guided empty state', async ({ page, request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    const customer = await loginProviderViaApi(request);
    if (!customer) test.skip(true, 'Provider unavailable');

    const appt = await seedAppointmentViaApi(request, customer, {
      date: tomorrowIso(),
      time: '14:00',
      patient_name: 'Clinical Prep E2E'
    });
    const apptId = appt.id || appt.appointment_id;
    seedTriageForAppointment(`triage_${apptId}`, appt.patient_id, appt.clinic_id);

    await loginViaUi(page, request);
    await gotoProviderPage(page, `calendar.html?id=${encodeURIComponent(apptId)}`);
    await page.locator('#tabClinical').click();
    const content = page.locator('#modalContent');
    await expect(content).toBeVisible({ timeout: 15_000 });
    const text = await content.innerText();
    expect(text.length).toBeGreaterThan(5);
    expect(text).toMatch(/OPQRST|clinical|prep|Kelly|No clinical|Chief complaint|triage|complaint|masked/i);
  });
});
