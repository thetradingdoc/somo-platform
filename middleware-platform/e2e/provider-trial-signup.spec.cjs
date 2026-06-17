'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, '..', 'middleware-dev.db');
}

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

  test('signup → email → assign-line (dev) → session snapshot', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: API_BASE });
    const email = uniqueEmail();
    const phone =
      process.env.TRIAL_E2E_PHONE ||
      `+1202${String(Math.floor(1000000 + Math.random() * 8999999))}`;

    const signup = await ctx.post('/api/signup', {
      data: {
        name: 'E2E Trial User',
        email,
        phone_number: phone,
        customer_type: 'saas',
        company_name: 'E2E Clinic',
        business_size: '1-10',
        api_features: ['voice_agent'],
        attribution: { utm_source: 'somo-demo', utm_campaign: 'e2e' }
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
        description: 'TRIAL_SIM_FLOW_ENABLED not set on server — assign-line/trial steps skipped'
      });
      return;
    }

    const assignLine = await ctx.post('/api/signup/assign-line', {
      data: { phone_number: phone }
    });
    const lineBody = await assignLine.json();
    if (!assignLine.ok()) {
      test.info().annotations.push({
        type: 'note',
        description: `assign-line ${assignLine.status()}: ${lineBody?.error || 'failed'}`
      });
    }
    expect(assignLine.ok()).toBeTruthy();
    expect(lineBody.success).toBe(true);
    expect(lineBody.phone_verified).toBe(true);
    expect(lineBody.trial_sim_flow).toBe(true);
    expect(lineBody.line_assigned).toBe(true);

    const customer = db.getCustomer(signupBody.customer_id);
    expect(customer.phone_verified).toBe(1);
    expect(customer.trial_status).toBe('active');
    expect(customer.trial_expires_at).toBeTruthy();
    expect(lineBody.twilio_phone_number || lineBody.trial?.twilio_phone_number || customer.twilio_phone_number).toMatch(
      /^\+1\d{10}$/
    );
    expect(customer.twilio_phone_sid).toBeTruthy();

    const acceptTerms = await ctx.post('/api/signup/accept-terms');
    expect(acceptTerms.ok()).toBeTruthy();
    const termsBody = await acceptTerms.json();
    expect(termsBody.success).toBe(true);

    let customerAfterTerms = db.getCustomer(signupBody.customer_id);
    expect(customerAfterTerms.merchant_id).toBeTruthy();
    const clinicRow = db.db
      .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
      .get(customerAfterTerms.merchant_id);
    expect(clinicRow?.clinic_id).toBeTruthy();

    await ctx.dispose();
  });
});
