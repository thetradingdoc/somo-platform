#!/usr/bin/env node
'use strict';

/**
 * Master front-desk pilot gate — structural phases + Kelly env + prod readiness.
 * Referenced by verify-deploy-readiness.cjs and FRONT_DESK_DEPLOY_CHECKLIST.md.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const steps = [
  ['unblocked-phases', 'verify:unblocked-phases'],
  ['kelly-rails-env', 'verify:kelly-rails-env'],
  ['phase0-front-desk', 'verify:phase0-front-desk'],
  ['phase1-front-desk', 'verify:phase1-front-desk'],
  ['pilot-prod-readiness', 'verify:pilot-prod-readiness']
];

function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Front Desk Pilot Gate (verify:front-desk-pilot) ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let pass = true;
  for (const [name, script] of steps) {
    console.log(`\n── ${name} ──`);
    const r = spawnSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit', env: process.env });
    if (r.status !== 0) {
      console.error(`❌ ${name} failed`);
      pass = false;
    } else {
      console.log(`✅ ${name}`);
    }
  }

  process.exit(pass ? 0 : 1);
}

main();
