'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';
const CLINIC_ID = process.env.RCM_E2E_CLINIC_ID || 'clinic-default';

async function middlewareUp(request) {
  try {
    const health = await request.get(`${API_BASE}/health`);
    return health.ok();
  } catch {
    return false;
  }
}

async function providerLogin(page) {
  const res = await page.request.post(`${API_BASE}/api/customers/login`, {
    data: { email: EMAIL, password: PASS, remember_me: false },
  });
  const json = await res.json();
  expect(res.ok()).toBeTruthy();
  expect(json.success).toBe(true);
  const customer = json.customer || {};
  await page.goto(`${API_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((c) => {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(c));
    sessionStorage.setItem(
      'user',
      JSON.stringify({ name: c.name || 'Provider', role: c.role || 'Provider', ...c })
    );
  }, customer);
  await page.goto(`${API_BASE}/business/revenue.html?tab=pipeline`, { waitUntil: 'networkidle' });
}

test.describe('Provider RCM command center UI', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) test.skip(true, 'Middleware not running');
  });

  test('shows human-readable stage labels after API seed', async ({ page, request }) => {
    await providerLogin(page);

    const start = await request.post(`${API_BASE}/api/rcm/journeys/start?clinic_id=${CLINIC_ID}`, {
      data: { clinic_id: CLINIC_ID, source: 'playwright', skip_gates: true },
    });
    const body = await start.json();
    expect(body.success).toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#rcmSummary')).toContainText('Journeys total');
    await expect(page.locator('#rcmStages')).toContainText('Pre-registration');
  });
});
