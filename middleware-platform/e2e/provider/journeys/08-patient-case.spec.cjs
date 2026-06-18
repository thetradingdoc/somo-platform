'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  sel
} = require('../helpers/portal-auth.cjs');

test.describe('08 — Patient case timeline', () => {
  test('patient-case loads timeline with patient_id query', async ({ page, request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'patient-case.html?patient_id=patient-e2e-demo');
    await expect(page.locator(sel.patientCaseTimeline)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#ppSidebarNav')).toBeVisible();
  });
});
