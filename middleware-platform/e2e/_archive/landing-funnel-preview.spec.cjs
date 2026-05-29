'use strict';

/**
 * Public routines preview API — week_one bundle for /start funnel.
 * Requires middleware on PW_API_BASE_URL (default http://127.0.0.1:4000).
 */

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);

async function isMiddlewareReachable(request) {
  try {
    const r = await request.get(`${API_BASE}/health`, { timeout: 5000 });
    return r.ok();
  } catch {
    return false;
  }
}

test.describe('Landing funnel — routines preview API', () => {
  test.beforeEach(async ({ request }) => {
    const ok = await isMiddlewareReachable(request);
    test.skip(!ok, `Middleware not reachable at ${API_BASE}`);
  });

  test('acne preview includes week_one expect for funnel UI', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/public/routines/acne/preview`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.preview.week_one).toBeTruthy();
    expect(String(data.preview.week_one.expect || '').length).toBeGreaterThan(10);
    expect(data.preview.week_one_red_flag).toBeTruthy();
  });

  test('concerns list returns five programs', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/public/routines/concerns`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.concerns.length).toBe(5);
  });
});
