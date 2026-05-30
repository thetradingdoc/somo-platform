'use strict';

const { test, expect } = require('@playwright/test');

const BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

test.describe('Somo provider login UI', () => {
  test.beforeEach(async ({ page }) => {
    try {
      const health = await page.request.get(`${BASE}/health`);
      if (!health.ok()) test.skip(true, 'Middleware not running');
    } catch {
      test.skip(true, 'Middleware not running');
    }
  });

  test('login page shows Somo branding and no demo block', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole('heading', { name: /sign in to your somo front desk/i })).toBeVisible();
    await expect(page.locator('img[alt="Somo"]')).toBeVisible();
    await expect(page.locator('#loginEmail')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.getByText(/demo login/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /provider@demo/i })).toHaveCount(0);
  });

  test('password field has inline show toggle', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const wrap = page.locator('.login-password-wrap');
    await expect(wrap).toBeVisible();
    await expect(wrap.locator('#loginPassword')).toBeVisible();
    await expect(wrap.locator('#loginShowPassword')).toBeVisible();
    await page.locator('#loginShowPassword').click();
    await expect(page.locator('#loginPassword')).toHaveAttribute('type', 'text');
  });

  test('footer links to signup', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const trialLink = page.getByRole('link', { name: /start your free trial/i });
    await expect(trialLink).toBeVisible();
    await expect(trialLink).toHaveAttribute('href', /\/signup/);
  });

  test('successful login honors safe ?redirect=', async ({ page }) => {
    const target = '/business/agent.html';
    await page.route('**/api/customers/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          customer: {
            id: 'e2e-mock-customer',
            email: 'e2e@example.com',
            name: 'E2E User',
            company_name: 'E2E Clinic',
            role: 'Provider'
          }
        })
      });
    });

    await page.goto(`${BASE}/login?redirect=${encodeURIComponent(target)}`);
    await page.locator('#loginEmail').fill('e2e@example.com');
    await page.locator('#loginPassword').fill('test-password-8');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await page.waitForURL(`**${target}`, { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe(target);
  });
});
