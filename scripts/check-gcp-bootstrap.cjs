#!/usr/bin/env node
'use strict';

/**
 * Verify staging GCP/Firebase/DNS + full Somo portal bundle (not landing-only SPA).
 * Usage: npm run gcp:bootstrap:check
 */

const UI = (process.env.UI_BASE_URL || 'https://myskinandcare.com').replace(/\/$/, '');
const API = (process.env.MIDDLEWARE_API_BASE || 'https://api.myskinandcare.com').replace(/\/$/, '');

async function fetchPage(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    return { status: res.status, ct: res.headers.get('content-type') || '', text };
  } catch (e) {
    return { status: 0, error: e.message, text: '' };
  }
}

function ok(id, detail) {
  console.log(`PASS ${id} — ${detail}`);
  return true;
}

function fail(id, detail) {
  console.error(`FAIL ${id} — ${detail}`);
  return false;
}

function hasSignupWizard(body) {
  const t = body.toLowerCase();
  return t.includes('signup-wizard-body') || t.includes('start your free trial') || t.includes('data-signup-step');
}

function hasLoginPortal(body) {
  const t = body.toLowerCase();
  return t.includes('loginemail') || t.includes('sign in to your somo front desk');
}

function isJsNotSpa(body, ct) {
  if (String(ct).toLowerCase().includes('javascript')) return true;
  const t = body.trim().toLowerCase();
  if (t.startsWith('<!doctype') || t.startsWith('<html')) return false;
  return body.includes('api.myskinandcare.com') || body.includes('function') || body.includes('const ');
}

async function main() {
  console.log('\nGCP / Firebase staging bootstrap check\n');
  console.log(`  UI:  ${UI}`);
  console.log(`  API: ${API}\n`);

  let all = true;

  const ui = await fetchPage(`${UI}/`);
  all = (ui.status >= 200 && ui.status < 400 ? ok : fail)('UI_ROOT', `status=${ui.status}`) && all;

  const apiHealth = await fetchPage(`${API}/health/live`);
  all =
    (apiHealth.status >= 200 && apiHealth.status < 300 ? ok : fail)(
      'API_HEALTH_LIVE',
      `status=${apiHealth.status}`
    ) && all;

  const signup = await fetchPage(`${UI}/signup`);
  const signupOk =
    signup.status >= 200 && signup.status < 400 && hasSignupWizard(signup.text);
  all =
    (signupOk ? ok : fail)(
      'UI_SIGNUP_WIZARD',
      signupOk
        ? 'portal signup wizard detected'
        : `status=${signup.status} — deploy full hosting-dist (npm run deploy:staging-hosting)`
    ) && all;

  const login = await fetchPage(`${UI}/login`);
  const loginOk =
    login.status >= 200 && login.status < 400 && hasLoginPortal(login.text);
  all =
    (loginOk ? ok : fail)(
      'UI_LOGIN_PORTAL',
      loginOk
        ? 'provider login page detected'
        : `status=${login.status} — expected loginEmail / Somo login heading`
    ) && all;

  const apiBase = await fetchPage(`${UI}/assets/js/api-base.js`);
  const apiBaseOk =
    apiBase.status >= 200 &&
    apiBase.status < 400 &&
    isJsNotSpa(apiBase.text, apiBase.ct) &&
    apiBase.text.includes('api.myskinandcare.com');
  all =
    (apiBaseOk ? ok : fail)(
      'UI_API_BASE_JS',
      apiBaseOk
        ? 'api-base.js → api.myskinandcare.com'
        : `status=${apiBase.status} — got SPA HTML or wrong API host`
    ) && all;

  console.log('');
  if (all) {
    console.log('Bootstrap check passed.\n');
    process.exit(0);
  }
  console.error('Bootstrap check failed.\n');
  process.exit(1);
}

main();
