'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123';

async function middlewareUp(request) {
  try {
    return (await request.get(`${API_BASE}/health`)).ok();
  } catch {
    return false;
  }
}

async function login(page, request, context) {
  const login = await request.post(`${API_BASE}/api/customers/login`, {
    data: { email: EMAIL, password: PASS, remember_me: true },
  });
  const json = await login.json();
  expect(login.ok()).toBeTruthy();
  const customer = json.customer || {};
  const { cookies } = await request.storageState();
  if (context && cookies.length) {
    await context.addCookies(cookies);
  }
  await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
    sessionStorage.setItem('user', JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c }));
  }, customer);
}

test.describe('Revenue hub', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('revenue hub loads with tab strip', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/revenue.html?tab=pipeline`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.pp-revenue-page-title')).toHaveText('Revenue');
    await expect(page.locator('.pp-revenue-tab.active')).toContainText('Pipeline');
    await expect(page.locator('#ppRevenuePanel-pipeline')).toBeVisible();
  });

  test('sidebar has single Revenue nav item', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/revenue.html`, { waitUntil: 'domcontentloaded' });
    const revenueLinks = page.locator('#ppSidebarNav a', { hasText: 'Revenue' });
    await expect(revenueLinks).toHaveCount(1);
    const navCount = await page.locator('#ppSidebarNav a.pp-nav-item').count();
    expect(navCount).toBeLessThanOrEqual(8);
  });

  test('legacy rcm.html redirects to revenue pipeline tab', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/rcm.html`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/revenue\.html\?tab=pipeline/);
  });

  test('tab switch to patient pay', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/revenue.html?tab=pipeline`, { waitUntil: 'domcontentloaded' });
    await page.locator('.pp-revenue-tab[data-tab="payments"]').click();
    await expect(page).toHaveURL(/tab=payments/);
    await expect(page.locator('#ppRevenuePanel-payments')).toBeVisible();
  });
});
