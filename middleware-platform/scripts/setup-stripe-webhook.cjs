#!/usr/bin/env node
'use strict';

/**
 * Create Stripe webhook endpoint for test or live mode.
 * Usage:
 *   node scripts/setup-stripe-webhook.cjs [--write-env]           # test
 *   node scripts/setup-stripe-webhook.cjs [--write-env] --live  # live
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Stripe = require('stripe');
const isLive = process.argv.includes('--live');
const writeEnv = process.argv.includes('--write-env');

const secretEnvKey = isLive ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_SECRET_KEY';
const webhookSecretEnvKey = isLive ? 'STRIPE_LIVE_WEBHOOK_SECRET' : 'STRIPE_WEBHOOK_SECRET';
const key = process.env[secretEnvKey];

const WEBHOOK_URL = process.env.STRIPE_WEBHOOK_URL || 'https://api.callsomo.com/webhooks/stripe';

const EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'payment_intent.succeeded'
];

async function main() {
  const expectedPrefix = isLive ? 'sk_live_' : 'sk_test_';
  if (!key || !key.startsWith(expectedPrefix)) {
    console.error(`Set ${secretEnvKey}=${expectedPrefix}... in middleware-platform/.env`);
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: '2024-04-10' });
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const e of existing.data) {
    if (e.url === WEBHOOK_URL) {
      await stripe.webhookEndpoints.del(e.id);
      console.log(`Removed prior ${isLive ? 'live' : 'test'} endpoint ${e.id}`);
    }
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: EVENTS,
    description: `Somo ${isLive ? 'production' : 'staging'} — voice billing + payments`
  });
  console.log(`Created webhook endpoint ${endpoint.id}`);

  const secret = endpoint.secret;
  if (!secret) {
    console.error('Webhook secret not returned. Re-run after deleting endpoint in Dashboard.');
    process.exit(1);
  }

  console.log(`${webhookSecretEnvKey}=${secret}`);

  if (writeEnv) {
    const envPath = path.join(__dirname, '../.env');
    let content = fs.readFileSync(envPath, 'utf8');
    const re = new RegExp(`^${webhookSecretEnvKey}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, `${webhookSecretEnvKey}=${secret}`);
    else content += `\n${webhookSecretEnvKey}=${secret}\n`;
    fs.writeFileSync(envPath, content);
    console.log(`\nUpdated .env with ${webhookSecretEnvKey}`);
  } else {
    console.log('\nRe-run with --write-env to append to middleware-platform/.env');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
