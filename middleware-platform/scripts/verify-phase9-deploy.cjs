#!/usr/bin/env node
'use strict';

/**
 * Phase 9 deploy + backlog gate (fd9-e2e-deploy, playwright onboarding, saved card, dental portal).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, '..', 'unified-dashboard');
const REPO = path.join(ROOT, '..');

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
    'scripts/verify-golden-loop-somo.cjs',
    'scripts/pre-deploy-smoke.cjs',
    'scripts/verify-deploy-readiness.cjs',
    'e2e/provider/onboarding-journey.spec.cjs'
  ];
  for (const f of required) {
    if (fs.existsSync(path.join(ROOT, f))) pass(report, `${f} exists`);
    else fail(report, `missing ${f}`);
  }

  const deployChecklist = path.join(REPO, 'docs/deployment/FRONT_DESK_DEPLOY_CHECKLIST.md');
  if (fs.existsSync(deployChecklist)) pass(report, 'FRONT_DESK_DEPLOY_CHECKLIST.md exists');
  else fail(report, 'missing deploy checklist');

  const pstn = fs.readFileSync(path.join(ROOT, 'services/pstn-voice-commerce-tools.js'), 'utf8');
  if (pstn.includes('card_on_file')) pass(report, 'saved card on call (pstn tools)');
  else fail(report, 'pstn card_on_file missing');

  const pay = fs.readFileSync(path.join(UI, 'patients/pay.html'), 'utf8');
  if (pay.includes('success-receipt-note')) pass(report, 'copay receipt polish');
  else fail(report, 'pay receipt note missing');

  const shell = fs.readFileSync(path.join(UI, 'assets/js/patient-shell.js'), 'utf8');
  if (shell.includes('dental_pay_only')) pass(report, 'dental patient portal scope');
  else fail(report, 'dental portal scope missing');

  const profile = fs.readFileSync(path.join(ROOT, 'routes/patient-profile.js'), 'utf8');
  if (profile.includes('portal_mode')) pass(report, 'patient features portal_mode API');
  else fail(report, 'patient features API missing portal_mode');

  const golden = spawnSync('node', ['scripts/verify-golden-loop-somo.cjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  });
  if (golden.status === 0) pass(report, 'verify-golden-loop-somo passed');
  else fail(report, `verify-golden-loop-somo failed: ${golden.stdout || golden.stderr}`);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
