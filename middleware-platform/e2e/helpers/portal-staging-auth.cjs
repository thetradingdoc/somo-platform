'use strict';

/**
 * Staging signup session for portal E2E — stores credentials in process.env for serial tests.
 */
const path = require('path');
const {
  uniqueStagingEmail,
  stagingDbConfigured,
  waitForEmailCodeFromStaging,
  API_BASE,
  UI_BASE
} = require('./staging-context.cjs');
const { saveState } = require('./portal-e2e-create-state.cjs');

let session = null;

async function runStagingSignupIfNeeded(config, { page, request, browser }) {
  if (config.pwEnv !== 'staging' && !config.isLocal) return null;
  if (config.pwMode !== 'create') return null;
  if (session) return session;
  if (config.providerEmail && config.providerPass) {
    session = { email: config.providerEmail, password: config.providerPass };
    return session;
  }
  if (!process.env.TRIAL_E2E_PHONE) {
    console.log('[portal-staging-auth] skip signup — TRIAL_E2E_PHONE unset');
    return null;
  }
  if (!stagingDbConfigured() && !process.env.STAGING_EMAIL_CODE) {
    console.log('[portal-staging-auth] skip signup — STAGING_DB_PATH or STAGING_EMAIL_CODE required');
    return null;
  }

  const email = uniqueStagingEmail();
  const phone = process.env.TRIAL_E2E_PHONE.replace(/\s/g, '');
  const password = process.env.PORTAL_E2E_SIGNUP_PASSWORD || 'PortalE2E!Pass123';
  const practice = config.somoPracticeName || 'Somo';

  console.log(`[portal-staging-auth] signup ${email}`);

  const signup = await request.post(`${API_BASE}/api/signup`, {
    data: {
      name: 'Portal E2E Dentist',
      email,
      phone_number: phone,
      customer_type: 'saas',
      company_name: practice,
      business_size: '1-10',
      api_features: ['voice_agent']
    }
  });
  if (!signup.ok()) {
    throw new Error(`signup API failed: ${signup.status()}`);
  }

  const code = await waitForEmailCodeFromStaging(email);
  const verify = await request.post(`${API_BASE}/api/signup/verify-email`, {
    data: { email, code }
  });
  if (!verify.ok()) throw new Error(`verify-email failed: ${verify.status()}`);

  const assign = await request.post(`${API_BASE}/api/signup/assign-line`, {
    data: { phone_number: phone }
  });
  if (!assign.ok()) throw new Error(`assign-line failed: ${assign.status()}`);

  await request.post(`${API_BASE}/api/signup/accept-terms`);

  saveState({ state: 'signup_complete', email, practice_name: practice }, 'staging API signup');

  process.env.PW_PROVIDER_EMAIL = email;
  process.env.PW_PROVIDER_PASS = password;

  session = { email, password, phone };
  return session;
}

async function loginProvider(request, page, email, password) {
  const login = await request.post(`${API_BASE}/api/customers/login`, {
    data: { email, password, remember_me: true }
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const { cookies } = await request.storageState();
  if (cookies.length && page) await page.context().addCookies(cookies);
  return login;
}

module.exports = { runStagingSignupIfNeeded, loginProvider, getSession: () => session };
