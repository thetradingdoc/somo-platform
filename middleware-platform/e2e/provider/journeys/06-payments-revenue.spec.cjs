'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  sel
} = require('../helpers/portal-auth.cjs');

test.describe('06 — Revenue payments tab', () => {
  test('payments tab loads without error', async ({ page, request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'revenue.html?tab=payments');
    await page.locator(sel.revenueTabPayments).click({ timeout: 5000 }).catch(() => {});
    const panel = page.locator('#ppRevenuePanel-payments, #revPaymentsPanel, [data-rev-panel="payments"]');
    await expect(panel.first()).toBeVisible({ timeout: 20_000 });
  });
});
