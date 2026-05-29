'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = process.env.RCM_E2E_CLINIC_ID || 'clinic-default';

test.describe('Patient public pay page', () => {
  test.beforeAll(async ({ request }) => {
    try {
      if (!(await request.get(`${API_BASE}/health`)).ok()) test.skip(true, 'Middleware not running');
    } catch {
      test.skip(true, 'Middleware not running');
    }
  });

  test('pay.html loads context for token', async ({ page, request }) => {
    const login = await request.post(`${API_BASE}/api/customers/login`, {
      data: {
        email: process.env.PW_PROVIDER_EMAIL || 'provider@doclittle.com',
        password: process.env.PW_PROVIDER_PASS || 'demo123',
        remember_me: false,
      },
    });
    expect(login.ok()).toBeTruthy();

    const payReq = await request.post(`${API_BASE}/api/rcm/payments/request?clinic_id=${CLINIC_ID}`, {
      data: { clinic_id: CLINIC_ID, amount: 5 },
    });
    const { pay_token: token } = await payReq.json();
    expect(token).toBeTruthy();

    await page.goto(`${API_BASE}/patients/pay.html?token=${encodeURIComponent(token)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('body')).toContainText(/pay|amount|card/i);
  });
});
