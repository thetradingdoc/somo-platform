'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Staging signup journey (callsomo.com + api.callsomo.com).
 *
 * Required env:
 *   TRIAL_E2E_PHONE — handset that receives real Twilio Verify SMS
 *   STAGING_DB_PATH — downloaded staging SQLite (email OTP from DB)
 *   STAGING_SMS_CODE — SMS code from phone (or set after manual read)
 *
 * Optional: STAGING_TEST_EMAIL_PREFIX, PW_UI_BASE_URL, PW_API_BASE_URL
 */

const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const {
  UI_BASE,
  API_BASE,
  apiRequestHeaders,
  uniqueStagingEmail,
  stagingDbConfigured,
  fetchEmailCodeFromDb,
  createApiContext,
  waitForEmailCodeFromStaging
} = require('./helpers/staging-context.cjs');

const mpRoot = path.join(__dirname, '..');

function assertCustomerInDb(email) {
  const script = path.join(mpRoot, 'scripts', 'staging-db-assert-customer.cjs');
  execFileSync(process.execPath, [script, `--email=${email}`], {
    stdio: 'inherit',
    env: process.env
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('Staging signup journey', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get(`${API_BASE}/health/live`, { headers: apiRequestHeaders() });
    expect(health.ok(), `API not healthy: ${API_BASE}/health/live`).toBeTruthy();
    if (!stagingDbConfigured()) {
      test.skip(true, 'Set STAGING_DB_PATH to staging SQLite for email OTP + DB asserts');
    }
    if (!process.env.TRIAL_E2E_PHONE) {
      test.skip(true, 'Set TRIAL_E2E_PHONE to a handset that receives staging SMS');
    }
  });

  test('S1 persona step loads', async ({ page }) => {
    await page.goto(`${UI_BASE}/signup?fresh=1&utm_source=somo`);
    await expect(page.getByRole('heading', { name: /which best describes you/i })).toBeVisible();
    await expect(page.getByText(/step 1 of/i)).toBeVisible();
    await expect(page.getByText(/no credit card required/i)).toBeVisible();
    await expect(page.locator('#signupPersonaGrid button')).toHaveCount(4);
  });

  test('S2–S7 full wizard through trial activation', async ({ browser }) => {
    test.skip(
      !process.env.STAGING_EMAIL_CODE,
      'Set STAGING_EMAIL_CODE from inbox (GCS snapshot lags live API). Or run test:e2e:staging-signup-api'
    );
    const email = uniqueStagingEmail();
    const phone = process.env.TRIAL_E2E_PHONE.replace(/\s/g, '');
    const context = await browser.newContext({ baseURL: UI_BASE, ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await page.goto(`${UI_BASE}/signup?fresh=1&utm_source=somo`);
      await page.getByRole('button', { name: /small business/i }).click();
      await expect(page.getByRole('heading', { name: /tell us about you/i })).toBeVisible();

      await page.locator('#signupName').fill('Staging E2E User');
      await page.locator('#signupCompany').fill('Staging E2E Co');
      await page.locator('#signupEmail').fill(email);
      await page.locator('#signupPhone').fill(phone.replace(/^\+1/, ''));
      await page.locator('#signupContinueBtn').click();

      await expect(page.getByRole('heading', { name: /where are you based/i })).toBeVisible();
      await page.locator('#signupCity').fill('Washington');
      await page.locator('#signupPostal').fill('20001');
      await page.locator('#signupContinueBtn').click();

      await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible({
        timeout: 30000
      });
      const emailCode = await waitForEmailCodeFromStaging(email);
      const digits = emailCode.split('');
      const inputs = page.locator('#signupCodeGrid input');
      for (let i = 0; i < 6; i++) {
        await inputs.nth(i).fill(digits[i] || '');
      }
      await page.locator('#signupContinueBtn').click();

      await expect(page.getByRole('heading', { name: /confirm your mobile/i })).toBeVisible({
        timeout: 20000
      });

      const smsCode = process.env.STAGING_SMS_CODE;
      if (!smsCode) {
        test.info().annotations.push({
          type: 'note',
          description:
            'Set STAGING_SMS_CODE env with SMS from TRIAL_E2E_PHONE, then re-run from phone step or full suite'
        });
        test.skip(true, 'STAGING_SMS_CODE not set — enter real Twilio Verify code');
      }

      await page.locator('#signupPhoneCode').fill(smsCode.replace(/\D/g, ''));
      await page.locator('#signupContinueBtn').click();

      await expect(page.locator('#signupRevealNumber')).toBeVisible({ timeout: 120000 });
      const lineText = await page.locator('#signupRevealNumber').textContent();
      expect(lineText).toMatch(/\+1[\d\s()-]{10,}/);

      await page.locator('#signupContinueBtn').click();
      await page.locator('#signupTermsCheck').check();
      await page.locator('#signupContinueBtn').click();

      await page.waitForURL(/trial-activation\.html/, { timeout: 30000 });
      await expect(page.locator('#activationAgent')).toHaveAttribute('href', /voice-setup\.html/);

      assertCustomerInDb(email);

      const session = await page.request.get(`${API_BASE}/api/signup/session`);
      expect(session.ok()).toBeTruthy();
      const sessionBody = await session.json();
      expect(sessionBody.customer?.twilio_phone_number).toMatch(/^\+1\d{10}$/);
    } finally {
      await context.close();
    }
  });

  test('S8 duplicate phone rejected on verify-phone/send', async ({ playwright }) => {
    const phone = process.env.TRIAL_E2E_PHONE?.replace(/\s/g, '');
    if (!phone) test.skip(true, 'TRIAL_E2E_PHONE required');
    if (!stagingDbConfigured()) test.skip(true, 'STAGING_DB_PATH required');

    const { findActiveTrialByPhone } = require(path.join(mpRoot, 'scripts', 'staging-db-utils.cjs'));
    if (!findActiveTrialByPhone(phone)) {
      test.skip(true, 'No active trial on TRIAL_E2E_PHONE in staging DB — complete signup first');
    }
    if (!process.env.STAGING_EMAIL_CODE) {
      test.skip(true, 'STAGING_EMAIL_CODE required for second signup verify-email');
    }

    const api = await createApiContext(playwright);
    const email = uniqueStagingEmail();
    try {
      const signup = await api.post('/api/signup', {
        data: {
          name: 'Dup Phone Test',
          email,
          phone_number: phone,
          customer_type: 'saas',
          company_name: 'Dup Co',
          api_features: ['voice_agent']
        }
      });
      expect(signup.ok()).toBeTruthy();
      const verifyEmail = await api.post('/api/signup/verify-email', {
        data: { email, code: process.env.STAGING_EMAIL_CODE }
      });
      expect(verifyEmail.ok()).toBeTruthy();

      const sendPhone = await api.post('/api/signup/verify-phone/send', {
        data: { phone_number: phone }
      });
      expect(sendPhone.status()).toBe(409);
      const body = await sendPhone.json();
      expect(body.error || body.message).toMatch(/active trial|phone/i);
    } finally {
      await api.dispose();
    }
  });
});
