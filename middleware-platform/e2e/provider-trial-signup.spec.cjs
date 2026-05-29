'use strict';

const { test, expect } = require('@playwright/test');
const db = require('../database');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

function uniqueEmail() {
  return `trial-e2e-${Date.now()}@example.com`;
}

async function middlewareUp(request) {
  try {
    const health = await request.get(`${API_BASE}/health`);
    return health.ok();
  } catch {
    return false;
  }
}

test.describe('Provider SIM trial signup (API)', () => {
  test.beforeAll(async ({ request }) => {
    if (!(await middlewareUp(request))) {
      test.skip(true, 'Middleware not running on PW_API_BASE_URL');
    }
  });

  test('signup → email → phone (dev OTP) → session snapshot', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: API_BASE });
    const email = uniqueEmail();
    const phone = '+1555555' + String(Math.floor(Math.random() * 9000) + 1000);

    const signup = await ctx.post('/api/signup', {
      data: {
        name: 'E2E Trial User',
        email,
        phone_number: phone,
        customer_type: 'saas',
        company_name: 'E2E Clinic',
        business_size: '1-10',
        api_features: ['voice_agent'],
        attribution: { utm_source: 'dodgecall', utm_campaign: 'e2e' }
      }
    });
    expect(signup.ok()).toBeTruthy();
    const signupBody = await signup.json();
    expect(signupBody.success).toBe(true);

    const codeRow = db.getActiveEmailVerificationCode(email);
    expect(codeRow?.code).toBeTruthy();

    const verifyEmail = await ctx.post('/api/signup/verify-email', {
      data: { email, code: codeRow.code }
    });
    expect(verifyEmail.ok()).toBeTruthy();
    const emailBody = await verifyEmail.json();
    expect(emailBody.success).toBe(true);
    expect(emailBody.customer?.email).toBe(email);

    const session = await ctx.get('/api/signup/session');
    if (session.status() === 404) {
      await ctx.dispose();
      test.skip(true, 'Restart middleware to load GET /api/signup/session');
    }
    expect(session.ok()).toBeTruthy();
    const sessionBody = await session.json();
    expect(sessionBody.success).toBe(true);
    expect(sessionBody.customer.id).toBeTruthy();

    if (!sessionBody.trial_sim_flow) {
      await ctx.dispose();
      test.info().annotations.push({
        type: 'note',
        description: 'TRIAL_SIM_FLOW_ENABLED not set on server — phone/trial steps skipped'
      });
      return;
    }

    const sendPhone = await ctx.post('/api/signup/verify-phone/send', {
      data: { phone_number: phone }
    });
    expect(sendPhone.ok()).toBeTruthy();

    const checkPhone = await ctx.post('/api/signup/verify-phone/check', {
      data: { phone_number: phone, code: '000000' }
    });
    expect(checkPhone.ok()).toBeTruthy();
    const phoneBody = await checkPhone.json();
    expect(phoneBody.success).toBe(true);
    expect(phoneBody.phone_verified).toBe(true);

    const customer = db.getCustomer(signupBody.customer_id);
    expect(customer.phone_verified).toBe(1);
    if (customer.trial_status === 'active') {
      expect(customer.trial_expires_at).toBeTruthy();
    }

    await ctx.dispose();
  });
});
