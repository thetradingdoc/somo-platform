#!/usr/bin/env node
'use strict';

/**
 * Phase 2 dental copay acceptance gate — structural + unit chain.
 * Full agent E2E requires RCM_E2E_USE_EXISTING_SERVER=1 + LLM keys (optional leg).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function fail(report, msg) {
  report.checks.push({ ok: false, message: msg });
  report.pass = false;
}

function pass(report, msg) {
  report.checks.push({ ok: true, message: msg });
}

function main() {
  const report = { pass: true, checks: [] };

  const required = [
    'services/resolve-admin-visit-codes.js',
    'services/resolve-amount-due.js',
    'services/eligibility-usage-service.js',
    'seeds/dental-payer-rules.js',
    'migrations/098_phase2_dental_copay.js',
    'scripts/e2e-kelly-dental-copay-conversation.cjs'
  ];
  for (const f of required) {
    if (fs.existsSync(path.join(ROOT, f))) pass(report, `exists: ${f}`);
    else fail(report, `missing: ${f}`);
  }

  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/plan-catalog.json'), 'utf8'));
  const practice = catalog.tiers.practice;
  if (practice.included_eligibility_checks_per_cycle === 400) {
    pass(report, 'plan-catalog practice includes 400 eligibility checks');
  } else {
    fail(report, 'plan-catalog practice eligibility allowance not set');
  }

  try {
    const { resolveAdminInsuranceCodes } = require('../services/resolve-admin-visit-codes');
    const r = resolveAdminInsuranceCodes({ visit_reason: 'cleaning', tenantSpecialty: 'Dental' });
    if (r.ok && r.primary_cpt === 'D1110') pass(report, 'admin resolver D1110 from cleaning');
    else fail(report, `admin resolver failed: ${JSON.stringify(r)}`);
  } catch (e) {
    fail(report, `admin resolver require failed: ${e.message}`);
  }

  const jest = spawnSync(
    'npx',
    [
      'jest',
      '--testPathPattern=resolve-admin-visit-codes|resolve-amount-due|resolve-patient-checkout|copay-quote-guard|payment-request-service|payment-flow-service',
      '--passWithNoTests',
      '--forceExit'
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } }
  );
  if (jest.status === 0) pass(report, 'jest unit chain passed');
  else {
    fail(report, `jest unit chain failed: ${jest.stdout || jest.stderr}`);
  }

  const e2e = spawnSync('node', ['scripts/e2e-kelly-dental-copay-conversation.cjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  });
  if (e2e.status === 0) pass(report, 'dental copay E2E scenarios 1–5 passed');
  else fail(report, `dental copay E2E failed: ${e2e.stdout || e2e.stderr}`);

  if (process.env.PHASE2_RUN_AGENT_E2E === '1') {
    pass(report, 'full LLM agent E2E enabled (tool-chain scenarios always run above)');
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
