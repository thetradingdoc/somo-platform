'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@doclittle.com';
const PASS = process.env.PW_PROVIDER_PASS || process.env.PW_PROVIDER_PASSWORD || 'demo123';

async function middlewareUp(request) {
  try {
    return (await request.get(`${API_BASE}/health`)).ok();
  } catch {
    return false;
  }
}

async function login(page, request) {
  const login = await request.post(`${API_BASE}/api/customers/login`, {
    data: { email: EMAIL, password: PASS, remember_me: true },
  });
  const json = await login.json();
  expect(login.ok()).toBeTruthy();
  expect(json.success).toBe(true);
  const customer = json.customer || {};
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

  test('calendar board visible at desktop width', async ({ page, request }) => {
    await login(page, request);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
    const board = page.locator('[data-testid="cal-schedule-board"]');
    await expect(board).toBeVisible();
    await expect(board.locator('.pp-schedule-board-grid')).toBeVisible();
    await expect(page.locator('.pp-cal-view-tab.active[data-view="board"]')).toBeVisible();
    await expect(page.locator('#calendarWrap')).toBeHidden();
  });

  test('calendar defaults to list on mobile', async ({ page, request }) => {
    await login(page, request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#scheduleBoard')).toBeHidden();
    await expect(page.locator('#calendarWrap')).toBeVisible();
    await expect(page.locator('.pp-cal-view-tab.active[data-view="list"]')).toBeVisible();
    await expect(page.locator('#calendar.fc')).toBeVisible({ timeout: 15_000 });
  });

  test('appointments layer does not flood month with availability', async ({ page, request }) => {
    await login(page, request);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('.pp-cal-layer-btn.active[data-layer="appointments"]')).toBeVisible();
    await page.locator('.pp-cal-view-tab[data-view="month"]').click();
    await expect(page.locator('#calendar.fc')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    const avCount = await page.locator('.fc-event').evaluateAll((nodes) =>
      nodes.filter((n) => /available|out of office/i.test(n.textContent || '')).length
    );
    expect(avCount).toBe(0);
  });

  test('calendar single page header and 28px title', async ({ page, request }) => {
    await login(page, request);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${API_BASE}/business/calendar.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#ppSidebarNav a').first()).toBeVisible({ timeout: 15_000 });
    const header = await page.evaluate(() => {
      const titleEl = document.getElementById('ppPageTitle');
      const sub = document.getElementById('ppPageSub');
      const titlePx = titleEl ? parseFloat(window.getComputedStyle(titleEl).fontSize) : 0;
      return {
        titleCount: document.querySelectorAll('h1.pp-page-title').length,
        subVisible: sub ? !sub.hidden && sub.textContent.includes('bookings') : false,
        titlePx,
        topbarPage: document.querySelector('.pp-topbar--page') != null,
      };
    });
    expect(header.titleCount).toBeGreaterThanOrEqual(1);
    expect(header.subVisible).toBe(true);
    expect(header.topbarPage).toBe(true);
    expect(header.titlePx).toBeGreaterThanOrEqual(26);
    expect(header.titlePx).toBeLessThanOrEqual(30);
  });
});
