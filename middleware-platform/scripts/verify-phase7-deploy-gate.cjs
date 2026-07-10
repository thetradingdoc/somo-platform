#!/usr/bin/env node
'use strict';

/**
 * Phase 7.9 — Production deploy gate (middleware + hosting checks).
 *
 * Usage:
 *   node scripts/verify-phase7-deploy-gate.cjs
 *   LIVE=1 node scripts/verify-phase7-deploy-gate.cjs   # hit callsomo.com + api.callsomo.com
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

function runNode(script, label, cwd = ROOT) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, [script], { cwd, stdio: 'inherit', env: process.env });
  const ok = r.status === 0;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  return ok;
}

async function checkLiveEndpoints() {
  const UI = (process.env.UI_BASE_URL || 'https://callsomo.com').replace(/\/$/, '');
  const API = (process.env.MIDDLEWARE_API_BASE || 'https://api.callsomo.com').replace(/\/$/, '');
  let pass = true;

  try {
    const ui = await fetch(`${UI}/business/today.html`, { redirect: 'follow' });
    const uiOk = ui.status >= 200 && ui.status < 400;
    console.log(`${uiOk ? '✅' : '❌'} UI today.html status=${ui.status}`);
    pass = uiOk && pass;
  } catch (e) {
    console.log(`❌ UI today.html — ${e.message}`);
    pass = false;
  }

  try {
    const api = await fetch(`${API}/health`);
    const apiOk = api.ok;
    console.log(`${apiOk ? '✅' : '❌'} API /health status=${api.status}`);
    pass = apiOk && pass;
  } catch (e) {
    console.log(`❌ API /health — ${e.message}`);
    pass = false;
  }

  return pass;
}

async function main() {
  console.log('\n=== Phase 7.9 Deploy Gate ===\n');
  let pass = true;

  pass = runNode('scripts/verify-phase7-kelly-rails-deploy.cjs', 'kelly-rails-env') && pass;
  pass = runNode('scripts/pre-deploy-smoke.cjs', 'pre-deploy-smoke') && pass;
  pass = runNode('scripts/verify-phase7-portal.cjs', 'phase7-portal-structural') && pass;

  const hostingBuild = path.join(REPO, 'scripts/build-staging-hosting.cjs');
  if (require('fs').existsSync(hostingBuild)) {
    console.log('\n── hosting build dry-check ──');
    console.log('✅ build-staging-hosting.cjs present (run manually before Firebase deploy)');
  }

  if (process.env.LIVE === '1' || process.argv.includes('--live')) {
    pass = (await checkLiveEndpoints()) && pass;
    pass = runNode('scripts/verify-kelly-rails-cloudrun-env.cjs', 'cloudrun-kelly-env') && pass;
  } else {
    console.log('\n⚠️  Skipping live endpoint checks (set LIVE=1 or --live)');
  }

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
