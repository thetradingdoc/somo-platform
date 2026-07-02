#!/usr/bin/env node
'use strict';

/**
 * Phase 2 B+C complete gate — Stedi *test* API only (no prod Stedi/Stripe required).
 * Run before customers / production billing. Prod keys deferred until go-live.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function runStep(name, cmd, args, extraEnv = {}) {
  console.log(`\n── ${name} ──\n`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      VOICE_ELIGIBILITY_SIMULATE: '0',
      STEDI_TEST_MODE: process.env.STEDI_TEST_MODE || '1',
      PHASE2_SANDBOX: '1',
      ...extraEnv
    },
    stdio: 'inherit'
  });
  return r.status === 0;
}

function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Phase 2 Sandbox Gate (Stedi test API — B + C)   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nProduction Stedi/Stripe deferred until paying customers.\n');

  const steps = [
    ['Sprint B — Somo pilot DB setup', 'npm', ['run', 'setup:phase2-somo']],
    ['Sprint B — ops check (sandbox)', 'npm', ['run', 'verify:phase2-ops']],
    ['Code gate — unit + E2E 1–5', 'npm', ['run', 'verify:phase2-dental-copay']],
    ['Sprint C — Stedi live test + shadow + pay parity', 'node', ['scripts/e2e-phase2-stedi-sandbox-acceptance.cjs']]
  ];

  const report = { pass: true, steps: [] };
  for (const [label, cmd, args] of steps) {
    const ok = runStep(label, cmd, args);
    report.steps.push({ label, ok });
    if (!ok) report.pass = false;
  }

  console.log('\n── Summary ──\n');
  for (const s of report.steps) {
    console.log(`${s.ok ? '✅' : '❌'} ${s.label}`);
  }

  if (!report.pass) {
    console.error('\n❌ Phase 2 sandbox gate failed\n');
    process.exit(1);
  }
  console.log('\n✅ Phase 2 sandbox complete (B + C) — prod Stedi/Stripe when you have customers\n');
}

main();
