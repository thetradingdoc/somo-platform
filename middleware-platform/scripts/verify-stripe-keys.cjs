#!/usr/bin/env node
'use strict';

/**
 * Smoke-test Stripe API keys from middleware-platform/.env
 * Usage: npm run verify:stripe-keys [-- --mode=test|live|both]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const {
  getStripeSecretKey,
  getStripePublishableKey,
  getStripeMode,
  getStripePriceEnvKeys,
  getStripeWebhookSecret
} = require('../utils/stripe-config');

function parseMode() {
  const arg = process.argv.find((a) => a.startsWith('--mode='));
  const mode = arg ? arg.split('=')[1] : 'test';
  if (mode === 'both') return ['test', 'live'];
  if (mode === 'live') return ['live'];
  return ['test'];
}

async function verifyMode(billingMode) {
  const report = {
    billing_mode: billingMode,
    pass: false,
    mode: null,
    account_id: null,
    publishable_key_prefix: null,
    checks: []
  };

  try {
    const secretKey = getStripeSecretKey({ billingMode });
    const publishableKey = getStripePublishableKey({ billingMode });
    report.mode = getStripeMode({ billingMode });
    report.publishable_key_prefix = `${publishableKey.slice(0, 12)}…`;

    const Stripe = require('stripe');
    const stripe = new Stripe(secretKey, { apiVersion: '2024-04-10' });

    const balance = await stripe.balance.retrieve();
    report.checks.push({
      ok: true,
      message: `balance.retrieve OK (available USD: ${balance.available?.[0]?.amount ?? 0})`
    });

    const account = await stripe.accounts.retrieve();
    report.account_id = account.id;
    report.checks.push({ ok: true, message: `account ${account.id}` });

    const priceKeys = getStripePriceEnvKeys(billingMode);
    const missingPrices = priceKeys.filter((k) => !String(process.env[k] || '').trim());
    if (missingPrices.length) {
      report.checks.push({
        ok: false,
        message: `Missing price env: ${missingPrices.join(', ')}`
      });
    } else {
      const starterKey = priceKeys[0];
      const starter = await stripe.prices.retrieve(process.env[starterKey]);
      report.checks.push({
        ok: true,
        message: `${starterKey} valid (${starter.id}, active=${starter.active})`
      });
    }

    if (getStripeWebhookSecret({ billingMode })) {
      report.checks.push({ ok: true, message: `${billingMode} webhook secret set` });
    } else {
      report.checks.push({
        ok: false,
        message: `${billingMode} webhook secret not set`
      });
    }

    report.pass = report.checks.every((c) => c.ok);
    return report;
  } catch (e) {
    report.checks.push({ ok: false, message: e.message });
    return report;
  }
}

async function main() {
  const modes = parseMode();
  const results = [];
  for (const billingMode of modes) {
    results.push(await verifyMode(billingMode));
  }

  const summary = {
    pass: results.every((r) => r.pass),
    active_billing_mode: process.env.STRIPE_BILLING_MODE || 'test',
    results
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.pass ? 0 : 1);
}

main();
