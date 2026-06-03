'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@doclittle.com';
const PASS = process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123';

const SHELL_PAGES = [
  '/business/today.html',
  '/business/agent.html',
  '/business/revenue.html',
  '/business/patients.html',
];

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

test.describe('Provider portal shell regression', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  for (const path of SHELL_PAGES) {
    test(`shell on ${path}`, async ({ page, request, context }) => {
      await login(page, request, context);
      await page.goto(`${API_BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
      expect(await page.locator('#ppSidebarNav a').count()).toBeGreaterThanOrEqual(5);
      await expect(page.locator('#ppKellyLive')).toBeVisible();
      await expect(page.locator('body')).toHaveClass(/provider-portal/);
      expect(await page.title()).toMatch(/^Somo Provider/);
    });
  }

  test('settings tabs switch', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/settings.html`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Billing' }).click();
    await expect(page.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true');
  });

  test('billing section redirects to revenue hub', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/billing.html?section=claims`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/revenue\.html\?tab=claims/);
  });

  test('billing overview redirects to revenue pipeline', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/billing.html?section=overview`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/revenue\.html\?tab=pipeline/);
  });

  test('calendar active nav', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#ppSidebarNav a.active')).toContainText(/Schedule/i);
  });

  test('calendar single page header and 28px title', async ({ page, request, context }) => {
    const pageErrors = [];
    await login(page, request, context);
    await page.setViewportSize({ width: 1280, height: 900 });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#calendar.fc')).toBeVisible({ timeout: 15_000 });
    const authErrors = pageErrors.filter((t) => /requireAuth is not defined/i.test(t));
    expect(authErrors, authErrors.join('\n')).toEqual([]);

    const header = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('h1.pp-page-title')].filter(
        (el) => el.offsetParent !== null || el.closest('.pp-topbar')
      );
      const titleEl = document.getElementById('ppPageTitle');
      const sub = document.getElementById('ppPageSub');
      const titlePx = titleEl ? parseFloat(window.getComputedStyle(titleEl).fontSize) : 0;
      return {
        titleCount: titles.length,
        hasPageHeader: !!document.querySelector('.page-header'),
        subVisible: sub ? !sub.hidden && sub.textContent.includes('bookings') : false,
        titlePx,
        topbarPage: document.querySelector('.pp-topbar--page') != null,
      };
    });
    expect(header.titleCount).toBe(1);
    expect(header.hasPageHeader).toBe(false);
    expect(header.subVisible).toBe(true);
    expect(header.topbarPage).toBe(true);
    expect(header.titlePx).toBeGreaterThanOrEqual(26);
    expect(header.titlePx).toBeLessThanOrEqual(30);
    await expect(page.locator('.pp-toolbar')).toBeVisible();
  });

  test('work queue tab shows exception area', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.goto(`${API_BASE}/business/revenue.html?tab=work`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.pp-section-label', { hasText: 'Exception inbox' })).toBeVisible();
  });

  test('patient pay tab on revenue hub', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/revenue.html?tab=payments`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pp-revenue-tab.active')).toContainText(/Patient pay/i);
    await expect(page.locator('#revPaySendBtn')).toBeVisible();
  });

  test('patients roster shell', async ({ page, request, context }) => {
    await login(page, request, context);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/patients.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('h1.pp-page-title')).toHaveText(/^Patient roster$/);
    expect(await page.locator('.page-header').count()).toBe(0);
    await expect(page.locator('#patientsDebugStrip')).toBeHidden();
    await expect(page.locator('#patientsKpiRow .pp-kpi')).toHaveCount(4);
    await expect(page.locator('#patientFilters .pp-ptab')).toHaveCount(3);
    await expect(page.locator('#patientsKpiRow .pp-kpi-val').first()).not.toHaveText('0', { timeout: 20_000 });
    const roster = page.locator('#patientsRosterGrid .pp-patient-card');
    await expect(roster.first()).toBeVisible({ timeout: 20_000 });
    expect(await roster.count()).toBeGreaterThanOrEqual(2);
    const panelBody = page.locator('.pp-panel-body--patients');
    await expect(panelBody).not.toContainText(/Loading patients/i);
    await expect(page.locator('.pp-panel-body--patients > .pp-patients-empty')).toHaveCount(0);
    await expect(page.locator('#patientsRosterGrid .pp-patients-empty-title', { hasText: /Could not load/i })).toHaveCount(0);
    await expect(page.locator('.pp-patient-card--compact').first()).toBeVisible();

    const totalKpi = await page.locator('#patientsKpiRow .pp-kpi-val').first().textContent();
    await page.locator('#patientFilters .pp-ptab[data-filter="ehr"]').click();
    await expect(page.locator('#patientsRosterGrid .pp-patients-empty-title')).toHaveText(/No patients with EHR/i);
    await expect(panelBody).not.toContainText(/Loading patients/i);
    await expect(page.locator('#patientsKpiRow .pp-kpi-val').first()).toHaveText(totalKpi || '');
  });
});
