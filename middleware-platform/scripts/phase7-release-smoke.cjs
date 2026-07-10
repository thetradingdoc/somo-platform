#!/usr/bin/env node
'use strict';

/**
 * Phase 7.8 — Automatable pre-release smoke (portal + PSTN structural + payment path).
 *
 * Usage:
 *   node scripts/phase7-release-smoke.cjs
 *   PHASE7_SKIP_PORTAL=1 node scripts/phase7-release-smoke.cjs
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(script, label, env = {}) {
  console.log(`\n── ${label} ──\n`);
  const args = [path.join(ROOT, script)];
  if (script.includes('portal-e2e-run')) args.push('--step=gates');
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  const ok = r.status === 0;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  return ok;
}

function main() {
  console.log('\n=== Phase 7.8 Release Smoke Suite ===\n');
  const steps = [
    ['scripts/verify-pilot-scenario-matrix.cjs', 'pilot-scenario-matrix'],
    ['scripts/vertical-pstn-scenarios.cjs', 'vertical-pstn-structural'],
    ['scripts/verify-postgres-gcs-reconciliation.cjs', 'postgres-gcs-reconciliation'],
    ['scripts/verify-postgres-mirror-lag.cjs', 'postgres-mirror-lag'],
    [
      'scripts/dental-pstn-scenarios.cjs',
      'dental-pstn-http-replay',
      {
        DENTAL_PSTN_STRUCTURAL: '1',
        KELLY_RAILS_V2: '1',
        CONVERSATION_MODE_ROUTING: 'enforce',
        VOICE_ELIGIBILITY_SIMULATE: '1'
      }
    ],
    ['scripts/verify-phase7-kelly-rails-deploy.cjs', 'kelly-rails-deploy-profile']
  ];

  if (!process.env.PHASE7_SKIP_PORTAL) {
    steps.push([
      'scripts/portal-e2e-run.cjs',
      'portal-e2e-gates',
      {}
    ]);
  }

  let pass = true;
  for (const [script, label, env] of steps) {
    if (script.includes('portal-e2e') && process.env.PHASE7_SKIP_PORTAL === '1') continue;
    pass = run(script, label, env || {}) && pass;
  }

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
