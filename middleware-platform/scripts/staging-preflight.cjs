#!/usr/bin/env node
'use strict';

/**
 * Phase 0 staging preflight — HTTP gates + optional owner row from STAGING_DB_PATH.
 * Writes manifest to middleware-platform/test-results/staging-preflight.json
 *
 * Usage:
 *   node scripts/staging-preflight.cjs
 *   STAGING_DB_PATH=./backups/middleware-staging.db node scripts/staging-preflight.cjs
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const http = require('http');
const https = require('https');

const mpRoot = path.join(__dirname, '..');
const repoRoot = path.join(mpRoot, '..');

const UI_BASE = (process.env.UI_BASE_URL || process.env.PW_UI_BASE_URL || 'https://callsomo.com').replace(
  /\/$/,
  ''
);
const API_BASE = (
  process.env.MIDDLEWARE_API_BASE ||
  process.env.API_BASE_URL ||
  process.env.PW_API_BASE_URL ||
  'https://api.callsomo.com'
).replace(/\/$/, '');

function fetchStatus(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(12000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

function gitSha() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function recordOwnerFromDb(manifest) {
  if (!process.env.STAGING_DB_PATH && !process.env.DB_PATH) {
    manifest.db_checks = { skipped: true, reason: 'STAGING_DB_PATH not set' };
    return;
  }
  try {
    const { getOwnerCustomer, resolveDbPath } = require('./staging-db-utils.cjs');
    const owner = getOwnerCustomer();
    manifest.db_checks = {
      skipped: false,
      db_path: resolveDbPath(),
      owner_customer_id: owner.id,
      owner_twilio_phone_number: owner.twilio_phone_number || null,
      owner_retell_agent_id: owner.retell_agent_id || null
    };
  } catch (e) {
    manifest.db_checks = { skipped: false, error: e.message };
  }
}

async function main() {
  const manifest = {
    generated_at: new Date().toISOString(),
    git_sha: gitSha(),
    ui_base: UI_BASE,
    api_base: API_BASE,
    checks: {}
  };

  const steps = [
    ['api_health_live', `${API_BASE}/health/live`],
    ['ui_landing', `${UI_BASE}/`],
    ['ui_signup', `${UI_BASE}/signup`],
    ['ui_login', `${UI_BASE}/login`]
  ];

  let ok = true;
  for (const [id, url] of steps) {
    const status = await fetchStatus(url);
    const pass = status >= 200 && status < 400;
    manifest.checks[id] = { url, status, pass };
    if (!pass) ok = false;
    console.log(`${pass ? '✅' : '❌'} ${id} → ${status} (${url})`);
  }

  console.log('\n==> week1 staging gate (HTTP)');
  const gate = spawnSync('npm', ['run', 'gate:week1:staging'], {
    cwd: mpRoot,
    stdio: 'inherit',
    env: { ...process.env, STAGING: '1', UI_BASE_URL: UI_BASE, MIDDLEWARE_API_BASE: API_BASE }
  });
  manifest.checks.week1_staging_gate = { exit_code: gate.status ?? 1, pass: gate.status === 0 };
  if (gate.status !== 0) ok = false;

  recordOwnerFromDb(manifest);

  console.log('\n==> Kelly Rails v2 env');
  const kellyEnv = spawnSync('node', ['scripts/verify-kelly-rails-env.cjs'], {
    cwd: mpRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, KELLY_RAILS_ENV_PROFILE: 'staging', STAGING: '1' }
  });
  const kellyEnvPass = kellyEnv.status === 0;
  manifest.checks.kelly_rails_env = {
    pass: kellyEnvPass,
    exit_code: kellyEnv.status ?? 1,
    stdout: (kellyEnv.stdout || '').trim().slice(0, 500),
    stderr: (kellyEnv.stderr || '').trim().slice(0, 500)
  };
  console.log(kellyEnv.stdout || kellyEnv.stderr || '');
  if (!kellyEnvPass) {
    console.error('❌ Kelly Rails env check failed — set KELLY_RAILS_V2=1 and KELLY_ALLOW_HYBRID_GRAPH=0 on Cloud Run.');
    ok = false;
  }

  if (manifest.db_checks && !manifest.db_checks.skipped && !manifest.db_checks.error) {
    if (!manifest.db_checks.owner_retell_agent_id) {
      manifest.db_checks.owner_retell_warning =
        'owner_retell_agent_id missing — set RETELL_API_KEY on Cloud Run and run npm run ensure:somo-owner';
      console.warn(`⚠️  ${manifest.db_checks.owner_retell_warning}`);
      if (process.env.STAGING_PREFLIGHT_STRICT === '1') {
        ok = false;
      }
    }
  }

  const outDir = path.join(mpRoot, 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'staging-preflight.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${outPath}`);

  if (!ok) {
    console.error('\nPreflight FAILED — fix HTTP/routing before signup/voice tests.');
    process.exit(1);
  }
  console.log('\nPreflight HTTP checks passed. Run signup/voice Playwright next.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
