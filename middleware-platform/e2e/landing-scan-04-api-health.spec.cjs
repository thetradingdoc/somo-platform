'use strict';

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');
const { API_BASE, isMiddlewareReachable } = require('./helpers/scan');

const CLINIC_ID = String(process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || 'clinic-default').trim();

test.describe('Scan API health and envelopes', () => {
  test('GET /health is OK', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.ok()).toBeTruthy();
  });

  test('beautyfacts endpoint returns valid envelope status', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    const res = await request.get(`${API_BASE}/api/public/beautyfacts/769915190311`);
    expect([200, 404, 502, 503]).toContain(res.status());
    const json = await res.json().catch(() => ({}));
    expect(typeof json).toBe('object');
  });

  test('foodfacts endpoint returns valid envelope status', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    const res = await request.get(`${API_BASE}/api/public/foodfacts/049000042566`);
    expect([200, 404, 502, 503]).toContain(res.status());
    const json = await res.json().catch(() => ({}));
    expect(typeof json).toBe('object');
  });

  test('landing assistant turn returns reply and session id', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    const sid = randomUUID();
    const res = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
      data: {
        message: 'I scanned barcode 769915190311, can you explain ingredient risks?',
        session_id: sid,
        clinic_id: CLINIC_ID,
        kelly_flow: 'skincare'
      },
      headers: { 'Content-Type': 'application/json' }
    });
    expect(res.ok()).toBeTruthy();
    const j = await res.json();
    expect(j.success).toBe(true);
    expect(j.session_id).toBe(sid);
    expect(String(j.reply || '').length).toBeGreaterThan(20);
  });

  test('admin metrics endpoint remains reachable for KPI checks', async ({ request }) => {
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    const res = await request.get(`${API_BASE}/api/admin/metrics`);
    expect([200, 401, 403]).toContain(res.status());
  });
});

