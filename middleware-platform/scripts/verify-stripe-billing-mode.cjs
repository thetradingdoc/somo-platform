#!/usr/bin/env node
'use strict';

/**
 * Stripe billing mode readiness (live deferred until first paying customer).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mode = String(process.env.STRIPE_BILLING_MODE || 'test').toLowerCase();
const report = { pass: true, mode, checks: [] };

function pass(msg) {
  report.checks.push({ ok: true, message: msg });
}

function fail(msg) {
  report.checks.push({ ok: false, message: msg });
  report.pass = false;
}

if (mode === 'live') {
  const required = [
    'STRIPE_LIVE_SECRET_KEY',
    'STRIPE_LIVE_WEBHOOK_SECRET',
    'STRIPE_LIVE_PRICE_STARTER',
    'STRIPE_LIVE_PRICE_PRACTICE',
    'STRIPE_LIVE_PRICE_CLINIC_PRO'
  ];
  for (const k of required) {
    if (process.env[k]) pass(`${k} set`);
    else fail(`${k} missing for live mode`);
  }
} else {
  pass('STRIPE_BILLING_MODE=test (pilot default)');
  pass('Live mode deferred until first paying customer');
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
