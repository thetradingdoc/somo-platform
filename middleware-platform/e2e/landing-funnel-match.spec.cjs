'use strict';

/**
 * Public funnel match + specialists API (goal-aware sales pipeline).
 */

const { test, expect } = require('@playwright/test');

const API_BASE = (process.env.PW_API_BASE_URL || process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  '',
);

async function isMiddlewareReachable(request) {
  try {
    const r = await request.get(`${API_BASE}/health`, { timeout: 5000 });
    return r.ok();
  } catch {
    return false;
  }
}

test.describe('Landing funnel — match API', () => {
  test.beforeEach(async ({ request }) => {
    const ok = await isMiddlewareReachable(request);
    test.skip(!ok, `Middleware not reachable at ${API_BASE}`);
  });

  test('cystic acne routes to program acne', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'cystic acne purging', user_goal: 'track_program' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.match.route).toBe('program');
    expect(data.match.concern_id).toBe('acne');
    expect(Array.isArray(data.match.scores)).toBe(true);
  });

  test('mole changed routes to specialist L0', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'mole changed color last month', user_goal: 'track_program' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('specialist');
    expect(data.match.layer).toBe('L0');
  });

  test('growth on stomach escalates to specialist', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'growth on stomach', user_goal: 'track_program' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('specialist');
  });

  test('vague rash clarifies with next_questions', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'rash 10 days', user_goal: 'track_program' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('clarify');
    expect(data.match.next_questions?.length).toBeGreaterThan(0);
  });

  test('find_specialist goal returns specialist without program', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'cystic acne', user_goal: 'find_specialist', zip: '10001' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('specialist');
    expect(data.match.concern_id).toBeNull();
  });

  test('both goal returns dual route', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'cystic acne', user_goal: 'both', zip: '10001' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('dual');
    expect(data.match.concern_id).toBe('acne');
    expect(data.match.companion_concern_id).toBe('acne');
  });

  test('anti_aging chip under track_program routes to anti_aging program', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: {
        inquiry: 'fine lines and wrinkles',
        concern_chip: 'anti_aging',
        user_goal: 'track_program',
      },
    });
    const data = await res.json();
    expect(data.match.route).toBe('program');
    expect(data.match.concern_id).toBe('anti_aging');
  });

  test('unmapped track text routes to clarify', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'idk my skin feels weird', user_goal: 'track_program' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('clarify');
  });

  test('not sure routes to clarify', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/public/funnel/match`, {
      data: { inquiry: 'not sure, just started noticing things', user_goal: 'track_program' },
    });
    const data = await res.json();
    expect(data.match.route).toBe('clarify');
  });

  test('specialists endpoint accepts zip', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/public/funnel/specialists?zip=10469&limit=5`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.disclaimer).toMatch(/Directory information only/i);
  });
});
