'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const { UI_BASE, API_BASE } = require('./callsomo-urls.cjs');

function uniqueStagingEmail() {
  const prefix = (process.env.STAGING_TEST_EMAIL_PREFIX || 'trial-e2e-staging').replace(/@.*/, '');
  return `${prefix}-${Date.now()}@doclittle.test`;
}

function stagingDbConfigured() {
  return !!(process.env.STAGING_DB_PATH || '').trim();
}

function fetchEmailCodeFromDb(email) {
  if (process.env.STAGING_EMAIL_CODE) {
    return String(process.env.STAGING_EMAIL_CODE).trim();
  }
  const script = path.join(__dirname, '..', '..', 'scripts', 'staging-db-utils.cjs');
  const out = execFileSync(
    process.execPath,
    ['-e', `const u=require(${JSON.stringify(script)});console.log(u.getEmailCode(${JSON.stringify(email)}))`],
    { encoding: 'utf8', env: process.env }
  );
  return out.trim();
}

/** Poll GCS staging snapshot until email_verification_codes row appears (live API writes to Cloud DB). */
async function waitForEmailCodeFromStaging(email, { attempts = 8, delayMs = 4000 } = {}) {
  if (process.env.STAGING_EMAIL_CODE) {
    return String(process.env.STAGING_EMAIL_CODE).trim();
  }
  const syncScript = path.join(__dirname, '..', '..', 'scripts', 'cloudrun-db-sync.cjs');
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    if (process.env.GCS_DB_BUCKET && i > 0) {
      execFileSync(process.execPath, [syncScript, 'download'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          DB_PATH: process.env.STAGING_DB_PATH || process.env.DB_PATH
        }
      });
    }
    try {
      return fetchEmailCodeFromDb(email);
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Email code not found for ${email} after ${attempts} GCS sync attempts. Set STAGING_EMAIL_CODE or refresh STAGING_DB_PATH. Last: ${lastErr}`
  );
}

function apiRequestHeaders() {
  const headers = { Accept: 'application/json' };
  if (process.env.PLAYWRIGHT_API_BEARER) {
    headers.Authorization = `Bearer ${process.env.PLAYWRIGHT_API_BEARER}`;
  }
  return headers;
}

async function createApiContext(playwright) {
  return playwright.request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: apiRequestHeaders()
  });
}

async function browserOnUi(playwright, request) {
  const storageState = await request.storageState();
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({
    baseURL: UI_BASE,
    storageState,
    ignoreHTTPSErrors: true
  });
  await context.addInitScript((api) => {
    window.API_BASE = api;
    window.resolveApiBase = () => api;
  }, API_BASE);
  const page = await context.newPage();
  return { browser, context, page };
}

function seedCustomerInPage(page, customer) {
  return page.addInitScript((c) => {
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
}

async function loginOwnerViaApi(request) {
  const email = process.env.SOMO_OWNER_EMAIL || process.env.PW_PROVIDER_EMAIL || '';
  const password = process.env.SOMO_OWNER_PASSWORD || process.env.PW_PROVIDER_PASSWORD || '';
  if (!email || !password) return null;

  const res = await request.post('/api/customers/login', {
    data: { email, password, remember_me: true }
  });
  if (!res.ok()) return null;
  const body = await res.json();
  if (!body.success || !body.customer) return null;
  return body.customer;
}

module.exports = {
  UI_BASE,
  API_BASE,
  apiRequestHeaders,
  uniqueStagingEmail,
  stagingDbConfigured,
  fetchEmailCodeFromDb,
  waitForEmailCodeFromStaging,
  createApiContext,
  browserOnUi,
  seedCustomerInPage,
  loginOwnerViaApi
};
