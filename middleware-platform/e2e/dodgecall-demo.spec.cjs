'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

test.describe('DodgeCall demo landing', () => {
  test('hero and demo form submit (mocked API)', async ({ page }) => {
    await page.route('**/api/public/dodgecall/request-call', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, demo_request_id: 'test-id', call_id: 'CA_test' })
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /AI call center from the future/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Try Our Live Demo/i }).first()).toBeVisible();

    await page.locator('select').selectOption('receptionist');
    await page.getByPlaceholder('Your Name').fill('Test User');
    await page.getByPlaceholder('+15551234567').fill('+15555550123');
    await expect(page.getByText(/signup link at this same number/i)).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Get a call/i }).click();

    await expect(page.getByText(/Calling you now/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /Sign up for DodgeCall/i })).toBeVisible();
  });

  test('request-call API validates consent', async ({ request }) => {
    try {
      const health = await request.get(`${API_BASE}/api/public/dodgecall/health`);
      if (!health.ok()) test.skip(true, 'Middleware not running');
    } catch {
      test.skip(true, 'Middleware not reachable');
    }

    const res = await request.post(`${API_BASE}/api/public/dodgecall/request-call`, {
      data: {
        name: 'Test',
        phone: '+15555550123',
        use_case: 'receptionist',
        consent: false
      }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
  });
});
