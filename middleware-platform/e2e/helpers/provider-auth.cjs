'use strict';

const path = require('path');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, '..', '..', 'var', 'db', 'middleware-dev.db');
}

const db = require('../../database');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

function uniqueEmail() {
  return `voice-e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

function ownerCredentials() {
  const email =
    process.env.PW_PROVIDER_EMAIL ||
    process.env.SOMO_OWNER_EMAIL ||
    process.env.RCM_E2E_PROVIDER_EMAIL ||
    'provider@callsomo.com';
  const password =
    process.env.PW_PROVIDER_PASSWORD ||
    process.env.PW_PROVIDER_PASS ||
    process.env.SOMO_OWNER_PASSWORD ||
    'demo123';
  return { email, password };
}

async function middlewareUp(request) {
  try {
    const health = await request.get('/health');
    return health.ok();
  } catch {
    return false;
  }
}

/**
 * Full trial signup via API (requires TRIAL_SIM_FLOW_ENABLED on server).
 * @returns {{ customer: object, email: string, phone: string, customerId: string }}
 */
async function createTrialCustomerViaApi(request) {
  const email = uniqueEmail();
  const phone =
    process.env.TRIAL_E2E_PHONE ||
    `+1202${String(Math.floor(1000000 + Math.random() * 8999999))}`;

  const signup = await request.post('/api/signup', {
    data: {
      name: 'Voice E2E User',
      email,
      phone_number: phone,
      customer_type: 'saas',
      company_name: 'Voice E2E Clinic',
      business_size: '1-10',
      api_features: ['voice_agent'],
      attribution: { utm_source: 'somo-demo', utm_campaign: 'voice-e2e' }
    }
  });
  const signupText = await signup.text();
  let signupBody = {};
  try {
    signupBody = JSON.parse(signupText);
  } catch (_) {}

  if (!signup.ok()) {
    const emailDelivery503 =
      signup.status() === 503 &&
      (signupBody.error === 'email_delivery_failed' ||
        signupText.includes('email_delivery_failed'));
    const codeRow = emailDelivery503 ? db.getActiveEmailVerificationCode(email) : null;
    if (!emailDelivery503 || !codeRow?.code) {
      throw new Error(`signup failed: ${signup.status()} ${signupText}`);
    }
    const existing = db.getCustomerByEmail(email);
    signupBody = {
      success: true,
      customer_id: codeRow.customer_id || existing?.id
    };
  } else if (!signupBody.success) {
    throw new Error(signupBody.error || 'signup not successful');
  }

  const codeRow = db.getActiveEmailVerificationCode(email);
  if (!codeRow?.code) {
    throw new Error('no email verification code in DB');
  }

  const verifyEmail = await request.post('/api/signup/verify-email', {
    data: { email, code: codeRow.code }
  });
  if (!verifyEmail.ok()) {
    throw new Error(`verify-email failed: ${verifyEmail.status()}`);
  }

  const session = await request.get('/api/signup/session');
  if (session.status() === 404) {
    throw new Error('GET /api/signup/session not available — restart middleware');
  }
  if (!session.ok()) {
    throw new Error(`session failed: ${session.status()}`);
  }
  const sessionBody = await session.json();
  if (!sessionBody.success) {
    throw new Error('session not successful');
  }

  let customer = sessionBody.customer || db.getCustomer(signupBody.customer_id);

  if (sessionBody.trial_sim_flow) {
    const assignLine = await request.post('/api/signup/assign-line', {
      data: { phone_number: phone }
    });
    if (!assignLine.ok()) {
      const pb = await assignLine.json().catch(() => ({}));
      throw new Error(pb.error || `assign-line failed: ${assignLine.status()}`);
    }

    const session2 = await request.get('/api/signup/session');
    if (session2.ok()) {
      const b2 = await session2.json();
      if (b2.customer) customer = b2.customer;
    }
    customer = db.getCustomer(customer.id) || customer;
  }

  db.updateCustomer(customer.id, {
    trial_status: 'active',
    voice_setup_completed_at: null
  });
  customer = db.getCustomer(customer.id);

  return { customer, email, phone, customerId: customer.id };
}

/**
 * Login via POST /api/customers/login using PW_PROVIDER_* or SOMO_OWNER_* env.
 * @returns {object|null} customer
 */
async function loginProviderViaApi(request) {
  const { email, password } = ownerCredentials();
  if (!email || !password) return null;

  const res = await request.post('/api/customers/login', {
    data: { email, password, remember_me: true }
  });
  if (!res.ok()) return null;
  const body = await res.json();
  if (!body.success || !body.customer) return null;
  return body.customer;
}

/**
 * Browser context with API cookies + sessionStorage customer seed.
 */
async function browserContextWithCustomer(playwright, request, customer) {
  const storageState = await request.storageState();
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({
    baseURL: API_BASE,
    storageState
  });
  await context.addInitScript((c) => {
    try {
      sessionStorage.setItem('authenticated', 'true');
      sessionStorage.setItem('customer', JSON.stringify(c));
      sessionStorage.setItem(
        'user',
        JSON.stringify({
          name: c.name || c.company_name || 'User',
          role: c.role || 'Provider',
          ...c
        })
      );
    } catch (_) {}
  }, customer);
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Prefer trial API user; fall back to owner env login.
 */
async function ensureAuthenticatedCustomer(request) {
  try {
    return await createTrialCustomerViaApi(request);
  } catch (trialErr) {
    const owner = await loginProviderViaApi(request);
    if (!owner) {
      throw trialErr;
    }
    db.updateCustomer(owner.id, {
      trial_status: 'active',
      voice_setup_completed_at: null
    });
    const customer = db.getCustomer(owner.id);
    return {
      customer,
      email: customer.email,
      phone: customer.phone_number,
      customerId: customer.id
    };
  }
}

module.exports = {
  API_BASE,
  middlewareUp,
  createTrialCustomerViaApi,
  loginProviderViaApi,
  browserContextWithCustomer,
  ensureAuthenticatedCustomer,
  ownerCredentials
};
