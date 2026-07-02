#!/usr/bin/env node
/**
 * Create Stripe test-mode products/prices for voice billing and print .env lines.
 * Usage: node scripts/setup-voice-stripe-test-prices.cjs [--write-env]
 * Requires STRIPE_SECRET_KEY (sk_test_...) in environment or .env via dotenv.
 */

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Stripe = require('stripe');
const key = process.env.STRIPE_SECRET_KEY;
if (!key || !key.startsWith('sk_test_')) {
  console.error('Set STRIPE_SECRET_KEY=sk_test_... in middleware-platform/.env');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2024-04-10' });
const writeEnv = process.argv.includes('--write-env');

const SAAS_TAX_CODE = 'txcd_10103001';

const CATALOG = {
  STRIPE_PRICE_STARTER: { name: 'Voice Starter', amount: 7900, recurring: true },
  STRIPE_PRICE_PRACTICE: { name: 'Voice Practice', amount: 19900, recurring: true },
  STRIPE_PRICE_CLINIC_PRO: { name: 'Voice Clinic Pro', amount: 39900, recurring: true },
  STRIPE_PRICE_TOPUP_SMALL: { name: 'Voice Top-Up 100 min', amount: 2000, recurring: false },
  STRIPE_PRICE_TOPUP_STANDARD: { name: 'Voice Top-Up 180 min', amount: 3000, recurring: false },
  STRIPE_PRICE_TOPUP_LARGE: { name: 'Voice Top-Up 330 min', amount: 5000, recurring: false }
};

async function ensurePrice(name, amountCents, recurring) {
  const product = await stripe.products.create({
    name: `Somo ${name}`,
    tax_code: SAAS_TAX_CODE
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amountCents,
    currency: 'usd',
    tax_behavior: 'exclusive',
    ...(recurring ? { recurring: { interval: 'month' } } : {})
  });
  return price.id;
}

async function main() {
  const lines = {};
  for (const [envKey, spec] of Object.entries(CATALOG)) {
    const priceId = await ensurePrice(spec.name, spec.amount, spec.recurring);
    lines[envKey] = priceId;
    console.log(`${envKey}=${priceId}`);
  }

  if (writeEnv) {
    const envPath = path.join(__dirname, '../.env');
    let content = fs.readFileSync(envPath, 'utf8');
    for (const [k, v] of Object.entries(lines)) {
      const re = new RegExp(`^${k}=.*$`, 'm');
      if (re.test(content)) content = content.replace(re, `${k}=${v}`);
      else content += `\n${k}=${v}\n`;
    }
    fs.writeFileSync(envPath, content);
    console.log('\nUpdated .env');
  } else {
    console.log('\nRe-run with --write-env to append to middleware-platform/.env');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
