#!/usr/bin/env node
'use strict';

/**
 * Pre-deploy smoke — Kelly env parity, log redaction, scenario matrix, ops artifacts.
 * Usage: node scripts/pre-deploy-smoke.cjs
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(script, label) {
  console.log(`\n── ${label} ──\n`);
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit', env: process.env });
  const ok = r.status === 0;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  return ok;
}

function main() {
  console.log('\n=== Pre-deploy smoke (front desk pilot) ===\n');
  const steps = [
    ['scripts/verify-staging-parity.cjs', 'verify-staging-parity'],
    ['scripts/verify-log-redaction.cjs', 'verify-log-redaction'],
    ['scripts/verify-pilot-scenario-matrix.cjs', 'verify-pilot-scenario-matrix'],
    ['scripts/verify-phase6-ops.cjs', 'verify-phase6-ops']
  ];

  let pass = true;
  for (const [script, label] of steps) {
    pass = run(script, label) && pass;
  }

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
