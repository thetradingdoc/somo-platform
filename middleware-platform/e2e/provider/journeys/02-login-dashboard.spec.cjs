'use strict';

const { test, expect } = require('@playwright/test');
const { middlewareUp, loginViaUi, gotoProviderPage, sel } = require('../helpers/portal-auth.cjs');

test.describe('02 — Login → Today dashboard', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running on :4000');
  });

  test('real login form reaches today with shell and schedule', async ({ page, request }) => {
    await loginViaUi(page, request);
    await expect(page).toHaveURL(/today\.html/);
    await expect(page.locator(sel.navToday)).toBeVisible();
    await expect(page.locator('#ppKellyLive')).toBeVisible();
    await expect(page.locator(sel.scheduleList)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(sel.kellyActivity)).toBeVisible();
  });
});
