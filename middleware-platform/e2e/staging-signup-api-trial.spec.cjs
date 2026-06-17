'use strict';

/**
 * Staging SIM trial signup — API-only (no browser).
 * Requires STAGING_EMAIL_CODE (real email OTP on staging).
 * Optional: STAGING_DB_PATH after GCS download for post-assert.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const { API_BASE, uniqueStagingEmail, createApiContext } = require('./helpers/staging-context.cjs');

const mpRoot = path.join(__dirname, '..');

test.describe('Staging signup API trial', () => {
  test('S2-S7 API: signup → email → assign-line → active trial', async ({ playwright }) => {
    if (!process.env.STAGING_EMAIL_CODE) {
      test.skip(true, 'Set STAGING_EMAIL_CODE (from inbox or Cloud SQL email_verification_codes)');
    }
    if (!process.env.TRIAL_E2E_PHONE) {
      test.skip(true, 'Set TRIAL_E2E_PHONE');
    }

    const api = await createApiContext(playwright);
    const email = uniqueStagingEmail();
    const phone = process.env.TRIAL_E2E_PHONE.replace(/\s/g, '');

    try {
      const signup = await api.post('/api/signup', {
        data: {
          name: 'Staging API Trial',
          email,
          phone_number: phone,
          customer_type: 'saas',
          company_name: 'Staging API Co',
          business_size: '1-10',
          api_features: ['voice_agent']
        }
      });
      expect(signup.ok()).toBeTruthy();
      const signupBody = await signup.json();
      expect(signupBody.success).toBe(true);

      const verifyEmail = await api.post('/api/signup/verify-email', {
        data: { email, code: process.env.STAGING_EMAIL_CODE }
      });
      expect(verifyEmail.ok()).toBeTruthy();

      const assignLine = await api.post('/api/signup/assign-line', {
        data: { phone_number: phone }
      });
      expect(assignLine.ok()).toBeTruthy();
      const lineBody = await assignLine.json();
      expect(lineBody.success).toBe(true);
      expect(lineBody.trial_sim_flow).toBe(true);
      expect(lineBody.line_assigned).toBe(true);

      const acceptTerms = await api.post('/api/signup/accept-terms');
      expect(acceptTerms.ok()).toBeTruthy();

      const session = await api.get('/api/signup/session');
      expect(session.ok()).toBeTruthy();
      const sessionBody = await session.json();
      expect(sessionBody.customer?.twilio_phone_number).toMatch(/^\+1\d{10}$/);

      if (process.env.STAGING_DB_PATH || process.env.DB_PATH) {
        const script = path.join(mpRoot, 'scripts', 'staging-db-assert-customer.cjs');
        execFileSync(process.execPath, [script, `--email=${email}`], {
          stdio: 'inherit',
          env: process.env
        });
      }
    } finally {
      await api.dispose();
    }
  });
});
