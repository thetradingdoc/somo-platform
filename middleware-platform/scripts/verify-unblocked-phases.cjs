#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const steps = [
  ['phase2-billing', 'npm', ['run', 'verify:phase2-billing']],
  ['phase2-golden-loop', 'npm', ['run', 'verify:phase2-golden-loop']],
  ['phase3-data', 'npm', ['run', 'verify:phase3-data']],
  ['phase4-pilot', 'node', ['scripts/verify-phase4-pilot.cjs']],
  ['phase6-ops', 'node', ['scripts/verify-phase6-ops.cjs']],
  ['phase7-portal', 'node', ['scripts/verify-phase7-portal.cjs']],
  ['phase8-loop', 'node', ['scripts/verify-phase8-loop.cjs']],
  ['phase5-fast-follows', 'node', ['scripts/verify-phase5-fast-follows.cjs']],
  ['phase9-deploy', 'node', ['scripts/verify-phase9-deploy.cjs']],
  ['ops-alerts-prod', 'node', ['scripts/verify-ops-alerts-prod.cjs']],
  ['stripe-billing-mode', 'npm', ['run', 'verify:stripe-billing-mode']]
];

let pass = true;
for (const [name, cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`❌ ${name} failed`);
    pass = false;
  } else {
    console.log(`✅ ${name}`);
  }
}
process.exit(pass ? 0 : 1);
