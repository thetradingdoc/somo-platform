#!/usr/bin/env node
'use strict';

/**
 * Compliance readiness — templates + phase0 structural gate (not live vendor signatures).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== Compliance readiness ===\n');
  let pass = true;

  const templates = [
    'docs/compliance/templates/CUSTOMER_BAA_TEMPLATE.md',
    'docs/compliance/templates/MSA_SERVICES_AGREEMENT_TEMPLATE.md',
    'docs/compliance/templates/HIPAA_RISK_ASSESSMENT_CHECKLIST.md',
    'docs/compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md'
  ];
  for (const rel of templates) {
    const p = path.join(REPO, rel);
    pass = check(rel, fs.existsSync(p)) && pass;
  }

  const baa = path.join(REPO, 'docs/compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md');
  if (fs.existsSync(baa)) {
    const body = fs.readFileSync(baa, 'utf8');
    if (!body.includes('compliance vault')) {
      console.log('ℹ️  BAA checklist should note: signatures stored in compliance vault (not in git)');
    }
  }

  const phase0 = spawnSync('node', ['scripts/verify-phase0-front-desk.cjs'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  pass = check('verify:phase0-front-desk', phase0.status === 0) && pass;

  console.log('\nLegal signatures (Stripe/GCP/LLM/customer BAA) are parallel ops — not engineering blockers.');
  console.log('Stedi BAA remains under Stedi vendor blocker.\n');

  process.exit(pass ? 0 : 1);
}

main();
