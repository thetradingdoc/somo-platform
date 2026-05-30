'use strict';

const { test, expect } = require('@playwright/test');

const UI = (process.env.PW_UI_BASE_URL || 'https://myskinandcare.com').replace(/\/$/, '');
const API = (process.env.PW_API_BASE_URL || 'https://api.myskinandcare.com').replace(/\/$/, '');

test.describe('Staging smoke (myskinandcare.com)', () => {
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
    const res = await request.get(`${API}/health/live`);
    expect(res.ok()).toBeTruthy();
  });
});
