'use strict';

const { test, expect } = require('@playwright/test');

const BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

test.describe('Somo signup wizard UI', () => {
  test.beforeEach(async ({ page, context }) => {
    try {
      const health = await page.request.get(`${BASE}/health`);
      if (!health.ok()) test.skip(true, 'Middleware not running');
    } catch {
      test.skip(true, 'Middleware not running');
    }
    await context.clearCookies();
  });

  test('signup page shows persona step and Somo branding', async ({ page }) => {
    await page.goto(`${BASE}/signup?utm_source=somo`);
    await expect(page.getByRole('heading', { name: /which best describes you/i })).toBeVisible();
    await expect(page.getByText(/step 1 of/i)).toBeVisible();
    await expect(page.getByText(/no credit card required/i)).toBeVisible();
    const grid = page.locator('#signupPersonaGrid');
    await expect(grid.locator('button')).toHaveCount(4);
    await expect(page.getByRole('button', { name: /clinic \/ healthcare/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /small business/i })).toBeVisible();
  });

  test('persona selection advances to business step', async ({ page }) => {
    await page.goto(`${BASE}/signup?utm_source=somo`);
    await expect(page.locator('#signupPersonaGrid button')).toHaveCount(4);
    await page.getByRole('button', { name: /small business/i }).click();
    await expect(page.getByRole('heading', { name: /tell us about you/i })).toBeVisible();
    await expect(page.getByLabel(/your name/i)).toBeVisible();
  });
});
