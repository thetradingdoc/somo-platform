'use strict';

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_PROD_API_BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '');

async function jsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

test.describe('Somo production API smoke (non-mocked)', () => {
  test('canonical somo-demo health is live', async ({ request }) => {
    const canonical = await request.get(`${API_BASE}/api/public/somo-demo/health`);
    const canonicalBody = await jsonOrText(canonical);

    expect(canonical.status(), `canonical body: ${JSON.stringify(canonicalBody)}`).toBe(200);
    expect(typeof canonicalBody).toBe('object');
    expect(canonicalBody).toHaveProperty('ok', true);
    expect(canonicalBody).toHaveProperty('demo_enabled');
  });

  test('request-call returns deterministic consent error code', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/public/somo-demo/request-call`, {
      data: {
        name: 'Prod Smoke',
        phone: '+15005550006',
        use_case: 'medical_clinic',
        consent: false
      }
    });
    const body = await jsonOrText(response);
    expect(response.status(), `body: ${JSON.stringify(body)}`).toBe(400);
    expect(typeof body).toBe('object');
    expect(body).toHaveProperty('error');
    expect(String(body.error || '').toLowerCase()).toContain('consent');
    expect(body.error_code).toBe('CONSENT_REQUIRED');
  });
});
