'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@doclittle.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';
const CLINIC_ID = process.env.RCM_E2E_CLINIC_ID || 'clinic-default';

async function middlewareUp(request) {
  try {
    return (await request.get(`${API_BASE}/health`)).ok();
  } catch {
    return false;
  }
}

test.describe('Provider patient payments UI', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('lists paid row after mark-paid', async ({ page, request }) => {
    const login = await request.post(`${API_BASE}/api/customers/login`, {
      data: { email: EMAIL, password: PASS, remember_me: false },
    });
    const customer = (await login.json()).customer || {};

    const start = await request.post(`${API_BASE}/api/rcm/journeys/start?clinic_id=${CLINIC_ID}`, {
      data: { clinic_id: CLINIC_ID, skip_gates: true },
    });
    const journeyId = (await start.json()).journey_id;

    const payReq = await request.post(`${API_BASE}/api/rcm/payments/request?clinic_id=${CLINIC_ID}`, {
      data: { clinic_id: CLINIC_ID, journey_id: journeyId, amount: 12.5 },
    });
    const payBody = await payReq.json();
    expect(payBody.success).toBe(true);

    const paid = await request.post(
      `${API_BASE}/api/rcm/payments/${payBody.payment_id}/mark-paid?clinic_id=${CLINIC_ID}`,
      { data: { clinic_id: CLINIC_ID } }
    );
    expect((await paid.json()).success).toBe(true);

    await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((c) => {
      sessionStorage.setItem('authenticated', 'true');
      sessionStorage.setItem('customer', JSON.stringify(c));
      sessionStorage.setItem(
        'user',
        JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c })
      );
    }, customer);
    await page.goto(`${API_BASE}/business/patient-payments.html`, { waitUntil: 'networkidle' });

    await expect(page.locator('#paymentsList')).toContainText('paid');
    await expect(page.locator('#paymentsList')).toContainText('12.50');
  });
});
