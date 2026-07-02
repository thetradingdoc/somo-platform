#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function runStep(name, cmd, args) {
  console.log(`\n── ${name} ──\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit', env: process.env });
  return r.status === 0;
}

function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Phase 3 Sandbox Gate (Somo PMS adapter — 3A)    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const steps = [
    ['Backfill — clinic PMS defaults', 'node', ['scripts/backfill-clinic-pms-defaults.cjs']],
    ['Setup — Somo PMS pilot', 'node', ['scripts/setup-phase3-somo-pilot.cjs']],
    ['Data orchestration gate', 'node', ['scripts/verify-phase3-data-orchestration.cjs']],
    ['Unit — pms-hub + phase3 data', 'npm', ['test', '--', '--testPathPattern=phase3-|pms-']],
    ['Context pull', 'node', ['scripts/verify-phase3-context-pull.cjs']],
    ['E2E scenario 6 — write-back', 'node', ['scripts/e2e-phase3-pms-writeback.cjs']],
    ['E2E combined journey', 'node', ['scripts/e2e-phase3-combined-journey.cjs']]
  ];

  let pass = true;
  for (const [label, cmd, args] of steps) {
    const ok = runStep(label, cmd, args);
    console.log(ok ? `✅ ${label}` : `❌ ${label}`);
    if (!ok) pass = false;
  }

  if (!pass) {
    console.error('\n❌ Phase 3 sandbox gate failed\n');
    process.exit(1);
  }
  console.log('\n✅ Phase 3A sandbox complete (external PMS adapters deferred to 3B)\n');
}

main();
