'use strict';

/**
 * Admin portal integration — real session cookie, no session API mocks.
 * @integration
 */
const { test, expect } = require('@playwright/test');
const { API_BASE, middlewareUp, loginAdmin, gotoAdminPage } = require('./helpers/admin-fixtures.cjs');

test.describe('@integration Admin portal auth (real session)', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
    if (!process.env.ADMIN_PORTAL_SECRET) {
      test.skip(true, 'Set ADMIN_PORTAL_SECRET for integration admin auth');
    }
  });

  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      sessionStorage.removeItem('admin_auth_redirect');
    });
    const session = await loginAdmin(request, page);
    expect(session?.ok?.() ?? session).toBeTruthy();
  });

  test('GET /api/admin/session reports authenticated after login', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/admin/session`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.success).toBe(true);
  });

  test('Tenants page loads with real admin session', async ({ page }) => {
    await gotoAdminPage(page, '/admin/tenants.html');
    await expect(page.locator('.admin-crm-data-table')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.admin-crm-sidebar .admin-crm-brand')).toBeVisible();
  });

  test('Feature flags page loads with real admin session', async ({ page }) => {
    await gotoAdminPage(page, '/admin/feature-flags.html');
    await expect(page.locator('.admin-crm-data-table')).toBeVisible({ timeout: 20_000 });
  });
});
