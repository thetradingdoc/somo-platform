#!/usr/bin/env node
'use strict';

/**
 * Portal E2E orchestrator — verbose terminal logging for all plan steps.
 *
 * Usage:
 *   node scripts/portal-e2e-run.cjs --step all
 *   node scripts/portal-e2e-run.cjs --step pull
 *   node scripts/portal-e2e-run.cjs --step audit
 *   node scripts/portal-e2e-run.cjs --step cleanup
 *   node scripts/portal-e2e-run.cjs --step gates
 *   node scripts/portal-e2e-run.cjs --step staging
 *   node scripts/portal-e2e-run.cjs --step prod-reuse
 *   node scripts/portal-e2e-run.cjs --step did-verify
 *   node scripts/portal-e2e-run.cjs --step trend
 *   node scripts/portal-e2e-run.cjs --step parity
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MP = path.join(__dirname, '..');
const ROOT = path.join(MP, '..');
const NODE = process.execPath;

function banner(msg) {
  const line = '='.repeat(72);
  console.log(`\n${line}\n  ${msg}\n${line}\n`);
}

function continueOnFail() {
  return process.argv.includes('--continue-on-fail');
}

function run(cmd, opts = {}) {
  console.log(`\n>>> ${cmd}\n`);
  try {
    return execSync(cmd, {
      cwd: opts.cwd || MP,
      env: { ...process.env, ...opts.env },
      stdio: 'inherit',
      shell: opts.shell !== false,
      ...opts
    });
  } catch (err) {
    if (opts.allowFail || continueOnFail()) {
      console.warn(`\nWARN: command failed (continuing): ${cmd}\n`);
      return err;
    }
    throw err;
  }
}

function stepPull() {
  banner('STEP 1: Pull fresh GCS prod snapshot');
  const dbPath = path.join(ROOT, 'backups', 'middleware-staging.db');
  try {
    run(`bash "${path.join(ROOT, 'scripts', 'phase1-pull-prod-db.sh')}"`, { cwd: ROOT });
  } catch (pullErr) {
    if (fs.existsSync(dbPath)) {
      console.warn('\nWARN: GCS pull failed — using existing snapshot (re-run gcloud auth if stale)\n');
    } else {
      throw pullErr;
    }
  }
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    console.log(`\nSnapshot OK: ${dbPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.error('Snapshot missing — run: gcloud auth login && npm run phase1:pull-db');
    process.exit(1);
  }
}

function stepAudit() {
  banner('STEP 2: Tenant audit (read-only)');
  const dbPath = path.join(ROOT, 'backups', 'middleware-staging.db');
  run(`"${NODE}" scripts/db-tenant-audit.cjs`, { env: { DB_PATH: dbPath } });
  run(`"${NODE}" scripts/portal-e2e-phase1-cleanup.cjs`, { env: { DB_PATH: dbPath } });
}

function stepCleanup(execute) {
  banner(`STEP 3: Phase 1 cleanup ${execute ? '(EXECUTE)' : '(dry-run)'}`);
  const dbPath = path.join(ROOT, 'backups', 'middleware-staging.db');
  const args = execute ? '--execute' : '';
  run(`"${NODE}" scripts/portal-e2e-phase1-cleanup.cjs ${args}`, { env: { DB_PATH: dbPath } });
}

function stepVerify() {
  banner('Phase 1 verify');
  const dbPath = path.join(ROOT, 'backups', 'middleware-staging.db');
  run(`"${NODE}" scripts/portal-e2e-phase1-verify.cjs`, { env: { DB_PATH: dbPath } });
}

function stepUpload() {
  banner('Upload cleaned DB to GCS');
  const dbPath = path.join(ROOT, 'backups', 'middleware-staging.db');
  const uploadSh = path.join(ROOT, 'scripts', 'phase1-upload-prod-db.sh');
  const { pathWithGcloud } = require('./gcs-cli-fallback.cjs');
  const err = run(`bash "${uploadSh}"`, {
    cwd: ROOT,
    env: {
      PATH: pathWithGcloud(),
      GCS_DB_BUCKET: process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo',
      PHASE1_DB_PATH: dbPath
    },
    allowFail: continueOnFail()
  });
  if (err && continueOnFail()) {
    console.warn(
      'Upload skipped — run manually after fixing gcloud PATH:\n' +
        `  PATH="${pathWithGcloud()}" bash scripts/phase1-upload-prod-db.sh\n` +
        '  or: GCS_DB_UPLOAD_FORCE=1 npm run portal-e2e:upload-db --prefix middleware-platform'
    );
    return;
  }
  if (err) throw err;
}

function stepGates() {
  banner('STEP 5-6: Deploy SHA + Stripe gates');
  try {
    run(`"${NODE}" scripts/verify-env-gates.cjs`, {
      env: { CLOUDRUN_VERIFY: process.env.CLOUDRUN_VERIFY || '1' }
    });
  } catch (e) {
    console.warn('\nWARN: deploy SHA gate failed (gcloud auth or revision mismatch)\n');
    if (!process.argv.includes('--continue-on-fail')) throw e;
  }
  try {
    run(`"${NODE}" scripts/verify-stripe-billing-mode.cjs`, {});
  } catch (e) {
    console.warn('\nWARN: stripe gate failed\n');
    if (!process.argv.includes('--continue-on-fail')) throw e;
  }
}

function stepPlaywright(env, mode, tier) {
  banner(`Playwright: PW_ENV=${env} PW_MODE=${mode} PW_TIER=${tier}`);
  const envVars = {
    PW_ENV: env,
    PW_MODE: mode,
    PW_TIER: tier,
    PLAYWRIGHT_BROWSERS_PATH: '.playwright-browsers'
  };
  if (env === 'production') {
    envVars.CLOUDRUN_VERIFY = '1';
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(
    npx,
    ['playwright', 'test', '-c', 'playwright.portal.config.cjs', '--project', 'portal-dentist-journey'],
    { cwd: MP, env: { ...process.env, ...envVars, PATH: process.env.PATH }, stdio: 'inherit', shell: process.platform === 'win32' }
  );
  if (r.status !== 0) {
    console.error(`\nPlaywright exited ${r.status}`);
    if (!process.argv.includes('--continue-on-fail')) process.exit(r.status || 1);
  }
}

function stepDidVerify() {
  banner('STEP 10: DID bind verify');
  run(`"${NODE}" scripts/portal-e2e-did-verify.cjs`, {});
}

function stepTrend() {
  banner('Trend report');
  run(`"${NODE}" scripts/portal-e2e-trend-report.cjs`, {});
}

function stepParity() {
  banner('Parity table');
  run(`"${NODE}" scripts/portal-e2e-parity-report.cjs`, {});
}

function parseStep() {
  const hit = process.argv.find((a) => a.startsWith('--step='));
  if (hit) return hit.split('=')[1];
  const idx = process.argv.indexOf('--step');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return 'all';
}

function main() {
  const step = parseStep();
  const executeCleanup = process.argv.includes('--execute-cleanup');

  banner(`Portal E2E orchestrator — step=${step}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Repo: ${ROOT}`);

  const steps = step === 'all'
    ? ['pull', 'audit', 'cleanup', 'upload', 'verify', 'gates', 'staging', 'trend', 'parity']
    : [step];

  for (const s of steps) {
    switch (s) {
      case 'pull':
        stepPull();
        break;
      case 'audit':
        stepAudit();
        break;
      case 'cleanup':
        stepCleanup(executeCleanup);
        break;
      case 'upload':
        stepUpload();
        break;
      case 'verify':
        stepVerify();
        break;
      case 'gates':
        stepGates();
        break;
      case 'staging':
        stepPlaywright('staging', 'create', 'p0+p1');
        break;
      case 'local':
        stepPlaywright('local', 'create', 'p0+p1');
        break;
      case 'prod-reuse':
        stepPlaywright('production', 'reuse', process.env.PW_TIER || 'p0');
        break;
      case 'prod-create':
        console.warn('\n⛔ BLOCKED: prod-create requires a real practice tenant — not in scope until signup exists.\n');
        break;
      case 'did-verify':
        console.warn('\n⛔ BLOCKED: 862 DID verify deferred until a real tenant owns +18623622415.\n');
        break;
      case 'somo-bind':
        console.warn('\n⛔ BLOCKED: portal-e2e-somo-bind retired — no fake Somo practice tenant.\n');
        break;
      case 'trend':
        stepTrend();
        break;
      case 'parity':
        try {
          stepParity();
        } catch (e) {
          if (!process.argv.includes('--continue-on-fail')) throw e;
        }
        break;
      default:
        console.error(`Unknown step: ${s}`);
        process.exit(2);
    }
  }

  banner('Orchestrator finished');
}

main();
