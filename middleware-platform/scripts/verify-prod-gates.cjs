#!/usr/bin/env node
'use strict';

/**
 * Meta-script for vendor-gated prod todos — skip-safe in dev.
 * Runs informational readiness checks without live Stedi/Dentrix cutover.
 *
 * Usage:
 *   npm run verify:prod-gates
 *   PILOT_PROD_STRICT=1 npm run verify:prod-gates
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function runStep(label, args) {
  console.log(`\n── ${label} ──\n`);
  const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  const code = r.status ?? 1;
  if (code === 0) {
    console.log(`✅ ${label}`);
  } else {
    console.warn(`⚠️  ${label} — exit ${code}${truthy(process.env.PILOT_PROD_STRICT) ? ' (strict)' : ' (informational)'}`);
  }
  return code;
}

function main() {
  const strict = truthy(process.env.PILOT_PROD_STRICT);
  console.log('\n=== Prod vendor gates (skip-safe) ===\n');
  console.log(`mode: ${strict ? 'STRICT' : 'informational'}\n`);

  const steps = [
    ['Pilot prod readiness', ['scripts/verify-pilot-prod-readiness.cjs']],
    ['Phase 3 Dentrix sandbox', ['scripts/verify-phase3-dentrix-sandbox.cjs']],
    ['Stedi prod checklist', ['scripts/setup-phase2-prod-stedi.cjs', '--check-only']],
    ['Henry Schein application', ['scripts/setup-henry-schein-application.cjs']]
  ];

  let failCount = 0;
  for (const [label, args] of steps) {
    if (runStep(label, args) !== 0) failCount += 1;
  }

  console.log(`\nSummary: ${steps.length - failCount}/${steps.length} steps green`);
  if (failCount && strict) {
    console.error('\n❌ Prod gates failed in strict mode — see docs/voice-agent/PROD_VENDOR_GATES.md\n');
    process.exit(1);
  }
  if (failCount) {
    console.log('\nℹ️  Dev mode — vendor gates are informational only.\n');
  }
  process.exit(0);
}

main();
