'use strict';

const path = require('path');
const { UI_BASE, API_BASE } = require('./callsomo-urls.cjs');

const RESULTS_DIR = path.join(__dirname, '..', '..', 'test-results', 'portal-e2e');
const STATE_FILE = path.join(RESULTS_DIR, 'somo-create-state.json');
const HISTORY_FILE = path.join(RESULTS_DIR, 'portal-e2e-history.jsonl');
const PARITY_FILE = path.join(RESULTS_DIR, 'parity-table.json');

const PROTECTED_CUSTOMER_IDS = new Set([
  'cust-navigation-demo',
  (process.env.CALLSOMO_OPERATOR_CUSTOMER_ID || '').trim()
].filter(Boolean));

const SOMO_PRACTICE_NAME = process.env.PORTAL_E2E_SOMO_PRACTICE || 'Somo';
const TENANT_DID = process.env.PORTAL_E2E_TENANT_DID || '+18623622415';
const DOC_LITTLE_CLINIC_ID = process.env.PORTAL_E2E_DOC_LITTLE_CLINIC || 'clinic-doclittle';
const P1_COVERAGE_WINDOW = Number(process.env.PORTAL_E2E_P1_WINDOW || 14);

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[portal-e2e ${ts}] ${msg}`);
}

function parseEnv() {
  const pwEnv = (process.env.PW_ENV || 'staging').toLowerCase();
  const pwMode = (process.env.PW_MODE || (pwEnv === 'production' ? 'reuse' : 'create')).toLowerCase();
  const pwTier = (process.env.PW_TIER || (pwEnv === 'production' ? 'p0' : 'p0+p1')).toLowerCase();
  const forceRollback = ['1', 'true', 'yes'].includes(
    String(process.env.PW_FORCE_ROLLBACK || '').toLowerCase()
  );

  const isProd = pwEnv === 'production';
  const isLocal = pwEnv === 'local';
  const tierIncludesP1 = pwTier === 'p0+p1' || pwTier === 'full';
  const tierIncludesP2 = pwTier === 'full';

  const providerEmail =
    process.env.PW_SOMO_PROD_EMAIL ||
    process.env.PW_PROVIDER_EMAIL ||
    '';
  const providerPass =
    process.env.PW_SOMO_PROD_PASS ||
    process.env.PW_PROVIDER_PASS ||
    '';

  return {
    pwEnv,
    pwMode,
    pwTier,
    forceRollback,
    isProd,
    isLocal,
    isStaging: pwEnv === 'staging',
    tierIncludesP1,
    tierIncludesP2,
    uiBase: isLocal ? (process.env.PW_UI_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, '') : UI_BASE,
    apiBase: isLocal ? (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, '') : API_BASE,
    providerEmail,
    providerPass,
    resultsDir: RESULTS_DIR,
    stateFile: STATE_FILE,
    historyFile: HISTORY_FILE,
    parityFile: PARITY_FILE,
    protectedCustomerIds: PROTECTED_CUSTOMER_IDS,
    somoPracticeName: SOMO_PRACTICE_NAME,
    tenantDid: TENANT_DID,
    doclittleClinicId: DOC_LITTLE_CLINIC_ID,
    p1CoverageWindow: P1_COVERAGE_WINDOW,
    runner: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local',
    actor: process.env.GITHUB_ACTOR || process.env.USER || 'unknown',
    gitSha: (process.env.GITHUB_SHA || process.env.PORTAL_E2E_GIT_SHA || '').slice(0, 7) || null,
    runId: process.env.GITHUB_RUN_ID || `local-${Date.now()}`
  };
}

module.exports = {
  parseEnv,
  log,
  RESULTS_DIR,
  STATE_FILE,
  HISTORY_FILE,
  PARITY_FILE,
  PROTECTED_CUSTOMER_IDS,
  SOMO_PRACTICE_NAME,
  TENANT_DID,
  DOC_LITTLE_CLINIC_ID,
  P1_COVERAGE_WINDOW
};
