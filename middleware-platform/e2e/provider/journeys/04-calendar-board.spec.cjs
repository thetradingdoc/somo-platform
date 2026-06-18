'use strict';

const { test, expect } = require('@playwright/test');
const {
  middlewareUp,
  loginViaUi,
  gotoProviderPage,
  loginProviderViaApi
} = require('../helpers/portal-auth.cjs');

test.describe('04 — Calendar board & design shell', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    const customer = await loginProviderViaApi(request);
    if (!customer) test.skip(true, 'Provider credentials unavailable');
  });

  test('desktop defaults to board view with schedule grid', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'calendar.html');
    await expect(page.locator('[data-testid="cal-schedule-board"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.pp-cal-view-tab.active[data-view="board"]')).toBeVisible();
    await expect(page.locator('#calendarWrap')).toBeHidden();
    await expect(page.locator('.pp-page-shell')).toBeVisible();
  });

  test('mobile defaults to list view', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'calendar.html');
    await expect(page.locator('.pp-cal-view-tab.active[data-view="list"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#calendarWrap')).toBeVisible();
    await expect(page.locator('[data-testid="cal-schedule-board"]')).toBeHidden();
  });

  test('appointments layer hides availability in month view', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'calendar.html');
    await page.locator('.pp-cal-view-tab[data-view="month"]').click();
    await expect(page.locator('.pp-cal-layer-btn.active[data-layer="appointments"]')).toBeVisible();
    const availLegend = page.locator('.legend-filter[data-status-key="available"]');
    await expect(availLegend).toBeHidden();
  });

  test('today page uses flat KPI shell', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginViaUi(page, request);
    await gotoProviderPage(page, 'today.html');
    await expect(page.locator('.pp-page-shell')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pp-kpi--flat').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  });
});
