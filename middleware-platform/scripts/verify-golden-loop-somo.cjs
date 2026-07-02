#!/usr/bin/env node
'use strict';

/**
 * Somo golden loop gate (LO-P0-6, fd9-e2e-deploy) — Phase 2 golden + Phase 3 sandbox + dental PSTN eval.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(name, cmd, args) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit', env: process.env });
  return { name, ok: r.status === 0 };
}

function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Somo Golden Loop (Phase 2 + 3 + dental eval)     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const steps = [
    ['verify-phase2-golden-loop', 'node', ['scripts/verify-phase2-golden-loop.cjs']],
    ['verify-phase3-sandbox', 'node', ['scripts/verify-phase3-sandbox.cjs']],
    ['verify-dental-pstn-eval', 'node', ['scripts/verify-dental-pstn-eval.cjs']]
  ];

  const checks = [];
  let pass = true;
  for (const [label, cmd, args] of steps) {
    const r = run(label, cmd, args);
    checks.push(r);
    if (!r.ok) pass = false;
  }

  console.log('\n' + JSON.stringify({ pass, checks }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
