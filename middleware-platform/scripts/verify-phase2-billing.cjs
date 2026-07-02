#!/usr/bin/env node
'use strict';

/**
 * Phase 2 billing enforcement gate (excludes Stedi prod — run verify:phase2-ops separately).
 */

const fs = require('fs');
const path = require('path');

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
    'services/apply-eligibility-usage.js',
    'services/eligibility-usage-alerts.js',
    'services/platform-fee-config.js',
    'services/payment-idempotency.js',
    'services/tcpa-consent-service.js',
    'services/eligibility-orchestrator.js',
    'services/byo-credentialing.js',
    'services/stedi-circuit-breaker.js',
    'services/eligibility-stripe-overage.js',
    'services/payment-reconciliation-audit.js',
    'services/payment-failed-alerts.js',
    'services/payer-preflight-service.js',
    'services/ppo-readback-service.js',
    'migrations/101_phase2_billing.js',
    'scripts/setup-phase2-shadow-week.cjs',
    '../docs/compliance/FRONT_DESK_COPAY_SETTLEMENT_DECISION.md'
  ];
  for (const f of required) {
    if (fs.existsSync(path.join(ROOT, f))) pass(report, `exists: ${f}`);
    else fail(report, `missing: ${f}`);
  }

  const ins = fs.readFileSync(path.join(ROOT, 'services/insurance-service.js'), 'utf8');
  if (ins.includes('applyEligibilityUsage')) pass(report, 'insurance-service wires applyEligibilityUsage');
  else fail(report, 'insurance-service missing applyEligibilityUsage');

  if (fs.readFileSync(path.join(ROOT, 'routes/rcm-public.js'), 'utf8').includes('tcpa-consent-service')) {
    pass(report, 'RCM pay create-intent TCPA gate');
  } else fail(report, 'RCM TCPA gate missing');

  const payHtml = fs.readFileSync(path.join(ROOT, '../unified-dashboard/patients/pay.html'), 'utf8');
  if (payHtml.includes('sms-consent')) pass(report, 'pay.html SMS consent checkbox');
  else fail(report, 'pay.html missing SMS consent');

  const orch = fs.readFileSync(path.join(ROOT, 'services/eligibility-orchestrator.js'), 'utf8');
  if (orch.includes('ppo_readback')) pass(report, 'eligibility-orchestrator PPO readback');
  else fail(report, 'eligibility-orchestrator missing PPO readback');

  const wh = fs.readFileSync(path.join(ROOT, 'routes/stripe-webhook-handler.js'), 'utf8');
  if (wh.includes('payment-failed-alerts')) pass(report, 'stripe webhook payment-failed alerts');
  else fail(report, 'stripe webhook missing payment-failed alerts');

  try {
    const db = require('../database');
    if (typeof db.trackMonthlyEligibilityUsage === 'function') {
      pass(report, 'DB trackMonthlyEligibilityUsage');
    } else fail(report, 'DB trackMonthlyEligibilityUsage missing');
  } catch (e) {
    fail(report, `database require: ${e.message}`);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
