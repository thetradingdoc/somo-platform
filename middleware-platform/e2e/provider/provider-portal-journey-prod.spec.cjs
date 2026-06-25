'use strict';

const { test, expect } = require('@playwright/test');
const sel = require('./helpers/portal-selectors.cjs');

const UI_BASE = (process.env.PW_PROD_UI_BASE_URL || 'https://callsomo.com').replace(/\/$/, '');
const API_BASE = (process.env.PW_PROD_API_BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '');

test.describe('Provider portal prod smoke (read-only)', () => {
  test.skip(!process.env.PW_PROVIDER_EMAIL, 'Set PW_PROVIDER_EMAIL and PW_PROVIDER_PASS for prod journey');

  test('login page loads', async ({ page }) => {
    await page.goto(`${UI_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(sel.loginEmail)).toBeVisible();
    await expect(page.locator(sel.loginSubmit)).toBeVisible();
  });

  test('api health responds', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('post-login today dashboard shows Kelly activity panel', async ({ page, request }) => {
    const email = process.env.PW_PROVIDER_EMAIL;
    const password = process.env.PW_PROVIDER_PASS;

    const login = await request.post(`${API_BASE}/api/customers/login`, {
      data: { email, password, remember_me: true }
    });
    expect(login.ok()).toBeTruthy();

    const { cookies } = await request.storageState();
    if (cookies.length) {
      await page.context().addCookies(cookies);
    }

    await page.goto(`${UI_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator(sel.loginEmail).fill(email);
    await page.locator(sel.loginPassword).fill(password);
    await page.locator(sel.loginSubmit).click();

    await page.waitForURL(/\/business\/today\.html/, { timeout: 45_000 });
    await expect(page.locator('#ppSidebarNav')).toBeVisible({ timeout: 20_000 });

    const panel = page.locator(sel.kellyActivity);
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).not.toContainText('Loading', { timeout: 30_000 });
  });
});
