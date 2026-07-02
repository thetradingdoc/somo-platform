#!/usr/bin/env node
'use strict';

/**
 * Prod ops alert webhook configuration gate (informational unless STRICT=1).
 * Usage: STRICT=1 node scripts/verify-ops-alerts-prod.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function main() {
  console.log('\n=== Ops alerts prod gate ===\n');
  const strict = process.env.STRICT === '1' || process.env.OPS_ALERTS_STRICT === '1';
  let pass = true;

  pass = check('eligibility-usage-alerts service', fs.existsSync(path.join(ROOT, 'services/eligibility-usage-alerts.js'))) && pass;
  pass = check('payment-failed-alerts service', fs.existsSync(path.join(ROOT, 'services/payment-failed-alerts.js'))) && pass;

  const envExample = path.join(ROOT, '.env.example');
  if (fs.existsSync(envExample)) {
    const body = fs.readFileSync(envExample, 'utf8');
    pass = check('.env.example documents ELIGIBILITY_ALERT_SLACK_WEBHOOK', body.includes('ELIGIBILITY_ALERT_SLACK_WEBHOOK')) && pass;
    pass = check('.env.example documents PAYMENT_ALERT_SLACK_WEBHOOK', body.includes('PAYMENT_ALERT_SLACK_WEBHOOK')) && pass;
  }

  const opsDoc = path.join(REPO, 'docs/voice-agent/unblocked-phases-ops.md');
  pass = check('unblocked-phases-ops documents webhooks', fs.existsSync(opsDoc) && fs.readFileSync(opsDoc, 'utf8').includes('ELIGIBILITY_ALERT_SLACK_WEBHOOK')) && pass;

  const eligSet = Boolean((process.env.ELIGIBILITY_ALERT_SLACK_WEBHOOK || '').trim());
  const paySet = Boolean((process.env.PAYMENT_ALERT_SLACK_WEBHOOK || '').trim());
  check('ELIGIBILITY_ALERT_SLACK_WEBHOOK set', strict ? eligSet : true, eligSet ? 'configured' : 'unset (OK for dev)');
  check('PAYMENT_ALERT_SLACK_WEBHOOK set', strict ? paySet : true, paySet ? 'configured' : 'unset (OK for dev)');

  console.log('\n' + JSON.stringify({ pass, strict, eligSet, paySet }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
