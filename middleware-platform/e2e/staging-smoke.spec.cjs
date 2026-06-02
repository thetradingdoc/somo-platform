'use strict';

const { test, expect } = require('@playwright/test');

const { UI_BASE: UI, API_BASE: API } = require('./helpers/callsomo-urls.cjs');

test.describe('Staging smoke (callsomo.com)', () => {
  test('landing loads', async ({ page }) => {
    const res = await page.goto(`${UI}/`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('signup page is HTML (not broken SPA)', async ({ page }) => {
    const res = await page.goto(`${UI}/signup`);
    expect(res?.status()).toBeLessThan(400);
    const html = await page.content();
    expect(html.toLowerCase()).toMatch(/signup|trial|somo/i);
  });

  test('login page loads', async ({ page }) => {
    await page.goto(`${UI}/login`);
    await expect(page.locator('#loginEmail')).toBeVisible({ timeout: 15000 });
  });

  test('API health/live', async ({ request }) => {
    const headers = {};
    if (process.env.PLAYWRIGHT_API_BEARER) {
      headers.Authorization = `Bearer ${process.env.PLAYWRIGHT_API_BEARER}`;
    }
    const res = await request.get(`${API}/health/live`, { headers });
    expect(res.ok()).toBeTruthy();
  });
});
