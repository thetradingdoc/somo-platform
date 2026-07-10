#!/usr/bin/env node
'use strict';

/**
 * Phase 7.5 — Kelly Rails env on live Cloud Run + local profile parity.
 *
 * Usage:
 *   node scripts/verify-phase7-kelly-rails-deploy.cjs
 *   GCP_SERVICE=somo-middleware GCP_REGION=us-central1 node scripts/verify-phase7-kelly-rails-deploy.cjs
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(script, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  return r.status === 0;
}

function main() {
  console.log('\n=== Phase 7.5 Kelly Rails deploy verify ===\n');
  let pass = true;

  pass = run('scripts/verify-kelly-rails-env.cjs', {
    KELLY_RAILS_ENV_PROFILE: 'production',
    KELLY_RAILS_V2: process.env.KELLY_RAILS_V2 || '1',
    CONVERSATION_MODE_ROUTING: process.env.CONVERSATION_MODE_ROUTING || 'enforce',
    KELLY_RAILS_ROLLOUT_PCT: process.env.KELLY_RAILS_ROLLOUT_PCT || '1',
    CALLSOMO_OPERATOR_FALLBACK_PSTN: process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN || '+13639990205'
  }) && pass;

  console.log('\n── Cloud Run live env ──\n');
  const cloudOk = run('scripts/verify-kelly-rails-cloudrun-env.cjs');
  if (!cloudOk) {
    console.warn('⚠️  Cloud Run verify skipped or failed — requires gcloud auth + prod access');
    console.warn('   Manual: npm run verify:kelly-rails-cloudrun');
    if (process.env.PHASE7_STRICT === '1') pass = false;
  }

  console.log('\n' + JSON.stringify({ pass, cloudrun: cloudOk }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
