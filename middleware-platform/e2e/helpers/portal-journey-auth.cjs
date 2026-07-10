'use strict';

/**
 * Full browser signup + voice-setup for portal E2E (staging + production create).
 * Persists auth artifacts for serial Playwright tests in the same run.
 */

const fs = require('fs');
const path = require('path');
const {
  uniqueStagingEmail,
  stagingDbConfigured,
  waitForEmailCodeFromStaging,
  seedCustomerInPage
} = require('./staging-context.cjs');
const { saveState, loadState, voiceSetupState } = require('./portal-e2e-create-state.cjs');

const AUTH_ARTIFACT = path.join(__dirname, '..', '..', 'test-results', 'portal-e2e', 'journey-auth.json');

let memorySession = null;

function signupEmailPrefix(config) {
  if (config.isProd) {
    return (process.env.PORTAL_E2E_PROD_SIGNUP_PREFIX || 'somo-prod-e2e').replace(/@.*/, '');
  }
  return (process.env.STAGING_TEST_EMAIL_PREFIX || 'portal-e2e-staging').replace(/@.*/, '');
}

function uniqueSignupEmail(config) {
  if (config.isStaging) return uniqueStagingEmail();
  const prefix = signupEmailPrefix(config);
  const domain = config.isProd ? 'callsomo.com' : 'doclittle.test';
  return `${prefix}-${Date.now()}@${domain}`;
}

function canRunBrowserSignup(config) {
  if (config.pwMode !== 'create' && config.pwMode !== 'resume') return false;
  if (config.pwMode === 'reuse') return false;
  if (!process.env.TRIAL_E2E_PHONE) {
    console.log('[portal-journey-auth] TRIAL_E2E_PHONE unset — cannot run browser signup');
    return false;
  }
  if (config.isProd) {
    if (!stagingDbConfigured() && !process.env.STAGING_EMAIL_CODE && !process.env.PORTAL_E2E_EMAIL_CODE) {
      console.log('[portal-journey-auth] prod create needs STAGING_DB_PATH or PORTAL_E2E_EMAIL_CODE for OTP');
      return false;
    }
  } else if (config.isStaging) {
    if (!stagingDbConfigured() && !process.env.STAGING_EMAIL_CODE) {
      console.log('[portal-journey-auth] staging create needs STAGING_DB_PATH or STAGING_EMAIL_CODE');
      return false;
    }
  }
  return true;
}

async function waitForEmailCode(email) {
  if (process.env.PORTAL_E2E_EMAIL_CODE) return String(process.env.PORTAL_E2E_EMAIL_CODE).trim();
  if (process.env.STAGING_EMAIL_CODE) return String(process.env.STAGING_EMAIL_CODE).trim();
  return waitForEmailCodeFromStaging(email);
}

async function persistAuth(page, customer, email, extra = {}) {
  const storageState = await page.context().storageState();
  const payload = {
    email,
    customer,
    storageState,
    ...extra,
    savedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(AUTH_ARTIFACT), { recursive: true });
  fs.writeFileSync(AUTH_ARTIFACT, JSON.stringify(payload, null, 2));
  memorySession = payload;
  process.env.PW_PROVIDER_EMAIL = email;
  if (extra.password) process.env.PW_PROVIDER_PASS = extra.password;
  return payload;
}

async function applyJourneyAuth(page, config) {
  const data = memorySession || (fs.existsSync(AUTH_ARTIFACT) ? JSON.parse(fs.readFileSync(AUTH_ARTIFACT, 'utf8')) : null);
  if (!data?.customer) return false;
  if (data.storageState?.cookies?.length) {
    await page.context().addCookies(data.storageState.cookies);
  }
  await seedCustomerInPage(page, data.customer);
  config.providerEmail = data.email;
  config.providerPass = data.password || config.providerPass;
  return true;
}

/**
 * Browser signup wizard (S2–S7) — same flow as staging-signup-journey.spec.cjs
 */
async function runBrowserSignupWizard(page, config) {
  const email = uniqueSignupEmail(config);
  const phone = process.env.TRIAL_E2E_PHONE.replace(/\s/g, '');
  const practice = config.somoPracticeName || 'Somo';
  const uiBase = config.uiBase;

  console.log(`[portal-journey-auth] browser signup ${email} env=${config.pwEnv}`);

  await page.goto(`${uiBase}/signup?fresh=1&utm_source=somo`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /small business/i }).click();
  await page.locator('#signupName').fill('Portal E2E Dentist');
  await page.locator('#signupCompany').fill(practice);
  await page.locator('#signupEmail').fill(email);
  await page.locator('#signupPhone').fill(phone.replace(/^\+1/, ''));
  await page.locator('#signupContinueBtn').click();

  await page.locator('#signupCity').fill('Washington');
  await page.locator('#signupPostal').fill('20001');
  await page.locator('#signupContinueBtn').click();

  const emailCode = await waitForEmailCode(email);
  const digits = emailCode.split('');
  const inputs = page.locator('#signupCodeGrid input');
  for (let i = 0; i < 6; i++) {
    await inputs.nth(i).fill(digits[i] || '');
  }
  await page.locator('#signupContinueBtn').click();

  await page.locator('#signupRevealNumber').waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator('#signupContinueBtn').click();
  await page.locator('#signupTermsCheck').check();
  await page.locator('#signupContinueBtn').click();

  await page.waitForURL(/trial-activation\.html/, { timeout: 60_000 });
  saveState({ state: 'signup_complete', email, practice_name: practice }, `${config.pwEnv} browser signup`);

  const sessionRes = await page.request.get(`${config.apiBase}/api/signup/session`);
  const sessionBody = sessionRes.ok() ? await sessionRes.json() : {};
  const customer = sessionBody.customer || { email, company_name: practice };

  return { email, customer, practice };
}

/**
 * Live voice-setup on callsomo.com (real APIs) — pattern from staging-voice-agent.spec.cjs
 */
async function runLiveVoiceSetup(page, config, startUrl) {
  const uiBase = config.uiBase;
  const target = startUrl || `${uiBase}/business/voice-setup.html`;
  console.log(`[portal-journey-auth] voice-setup ${target}`);

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const onWizard = /voice-setup\.html/.test(page.url());
  if (!onWizard) {
    if (/today\.html|agent\.html/.test(page.url())) {
      saveState({ state: 'did_bind_pending' }, 'voice-setup already complete');
      return { completed: true, skipped: true };
    }
    throw new Error(`expected voice-setup, got ${page.url()}`);
  }

  saveState({ state: voiceSetupState(1) }, 'voice-setup step 1');

  const practiceInput = page.locator('#setupPracticeName');
  if (await practiceInput.isVisible().catch(() => false)) {
    const practice = config.somoPracticeName || 'Somo';
    await practiceInput.fill(practice);
    const transfer = page.locator('#setupTransferNumber');
    if (await transfer.isVisible().catch(() => false)) {
      await transfer.fill(process.env.PORTAL_E2E_TRANSFER_NUMBER || '+12025550199');
    }
    const clinicEmail = page.locator('#setupClinicEmail');
    if (await clinicEmail.isVisible().catch(() => false)) {
      await clinicEmail.fill(process.env.PORTAL_E2E_CLINIC_EMAIL || 'frontdesk@somo.test');
    }
    const next1 = page.locator('#setupNext1');
    if (await next1.isVisible().catch(() => false)) await next1.click();
  }

  const greeting = page.locator('#setupGreeting');
  if (await greeting.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await greeting.fill(`Thank you for calling ${config.somoPracticeName || 'Somo'}. How can I help you today?`);
    saveState({ state: voiceSetupState(3) }, 'voice-setup greeting');
    const next = page.locator('#setupNext3, #setupNext1').first();
    if (await next.isVisible().catch(() => false)) await next.click();
  }

  for (let step = 2; step <= 6; step++) {
    saveState({ state: voiceSetupState(step) }, `voice-setup step ${step}`);
    const nextBtn = page.locator(`#setupNext${step}, #setupNext${step + 1}`).first();
    const finishBtn = page.locator('#setupFinish');
    if (await finishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await finishBtn.click();
      break;
    }
    if (await nextBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await nextBtn.click();
    }
    if (/today\.html|agent\.html/.test(page.url())) break;
  }

  await page.waitForURL(/today\.html|agent\.html/, { timeout: 120_000 }).catch(() => {});

  if (/voice-setup\.html/.test(page.url())) {
    const altFinish = page.locator('#setupFinish');
    if (await altFinish.isVisible().catch(() => false)) await altFinish.click();
    await page.waitForURL(/today\.html|agent\.html/, { timeout: 60_000 }).catch(() => {});
  }

  const completed = /today\.html|agent\.html/.test(page.url());
  if (completed) {
    saveState({ state: 'did_bind_pending' }, 'voice-setup complete');
  }
  return { completed, url: page.url() };
}

/**
 * Full create path: signup wizard → voice-setup → persist session for later P0 tests
 */
async function ensureJourneyCreateSession(config, { page }) {
  if (config.pwMode === 'reuse') return null;

  if (config.pwMode === 'resume') {
    const st = loadState();
    if (st.email) config.providerEmail = st.email;
    if (await applyJourneyAuth(page, config)) return memorySession;
    if (config.providerEmail) {
      await page.goto(`${config.uiBase}/login`, { waitUntil: 'domcontentloaded' });
      return { email: config.providerEmail, resumed: true };
    }
  }

  const st = loadState();
  if (config.isProd && config.pwMode === 'create' && st.state === 'complete') {
    console.log('[portal-journey-auth] prod create blocked — state=complete');
    return null;
  }

  if (!canRunBrowserSignup(config)) return null;

  if (config.pwMode === 'resume' && String(st.state).startsWith('voice_setup_')) {
    await applyJourneyAuth(page, config).catch(() => {});
    const vs = await runLiveVoiceSetup(page, config, `${config.uiBase}/business/voice-setup.html`);
    const sessionRes = await page.request.get(`${config.apiBase}/api/signup/session`);
    const body = sessionRes.ok() ? await sessionRes.json() : {};
    return persistAuth(page, body.customer || { email: st.email }, st.email);
  }

  const { email, customer, practice } = await runBrowserSignupWizard(page, config);

  const activationLink = page.locator('#activationAgent, a[href*="voice-setup"]').first();
  if (await activationLink.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await activationLink.click();
  } else {
    await page.goto(`${config.uiBase}/business/voice-setup.html`, { waitUntil: 'domcontentloaded' });
  }

  const vs = await runLiveVoiceSetup(page, config);
  const sessionRes = await page.request.get(`${config.apiBase}/api/signup/session`);
  const body = sessionRes.ok() ? await sessionRes.json() : {};
  const finalCustomer = body.customer || customer;

  return persistAuth(page, finalCustomer, email, {
    practice,
    voiceSetup: vs,
    password: process.env.PORTAL_E2E_SIGNUP_PASSWORD || null
  });
}

async function apiWithJourneyCookies(page, config, method, url, options = {}) {
  const data = memorySession || (fs.existsSync(AUTH_ARTIFACT) ? JSON.parse(fs.readFileSync(AUTH_ARTIFACT, 'utf8')) : null);
  if (data?.storageState?.cookies?.length) {
    return page.request.fetch(`${config.apiBase}${url}`, { method, ...options });
  }
  return page.request.fetch(`${config.apiBase}${url}`, { method, ...options });
}

module.exports = {
  AUTH_ARTIFACT,
  canRunBrowserSignup,
  ensureJourneyCreateSession,
  applyJourneyAuth,
  runBrowserSignupWizard,
  runLiveVoiceSetup,
  apiWithJourneyCookies,
  getJourneySession: () => memorySession
};
