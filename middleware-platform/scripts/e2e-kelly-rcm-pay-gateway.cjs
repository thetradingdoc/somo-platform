#!/usr/bin/env node
'use strict';

/**
 * Kelly-initiated RCM pay gateway — agent tool → pay link → Stripe / USDC settlement.
 *
 * Usage:
 *   RCM_E2E_USE_EXISTING_SERVER=1 node scripts/e2e-kelly-rcm-pay-gateway.cjs
 *   RCM_E2E_STRIPE_LIVE=1 RCM_E2E_USE_EXISTING_SERVER=1 node scripts/e2e-kelly-rcm-pay-gateway.cjs
 *   RCM_E2E_USDC_LIVE=1 RCM_E2E_PATIENT_ID=Patient/... node scripts/e2e-kelly-rcm-pay-gateway.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const https = require('https');

const API_BASE = (process.env.PW_API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CLINIC_ID = process.env.RCM_E2E_CLINIC_ID || 'clinic-default';
const STRIPE_LIVE = process.env.RCM_E2E_STRIPE_LIVE === '1';
const USDC_LIVE = process.env.RCM_E2E_USDC_LIVE === '1';
const PATIENT_ID = process.env.RCM_E2E_PATIENT_ID || null;

function request(method, path, body) {
  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`);
  const payload = body ? JSON.stringify(body) : null;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function kellyPaymentRequest(amount, patientId) {
  const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
  const result = await KellyToolExecutor.execute(
    'request_patient_payment',
    {
      amount,
      patient_id: patientId,
      delivery: 'email',
    },
    {
      sessionId: `gateway_e2e_${Date.now()}`,
      clinicId: CLINIC_ID,
      patientId,
      channel: 'voice',
    }
  );
  if (!result?.success || !result.pay_token) {
    throw new Error(result?.error || 'Kelly request_patient_payment failed');
  }
  if (!String(result.pay_url || '').includes('pay.html?token=')) {
    throw new Error(`Unexpected pay_url: ${result.pay_url}`);
  }
  return result;
}

async function assertPaid(token, expectedMethod) {
  const ctx = await request('GET', `/api/public/rcm/pay/${encodeURIComponent(token)}`);
  if (ctx.status !== 200 || !ctx.json.already_paid) {
    throw new Error(`Expected already_paid for token; got ${ctx.status} ${JSON.stringify(ctx.json)}`);
  }
  if (ctx.json.payment?.status !== 'paid') {
    throw new Error(`Expected payment.status=paid, got ${ctx.json.payment?.status}`);
  }
  if (expectedMethod && ctx.json.payment?.method !== expectedMethod) {
    throw new Error(`Expected method=${expectedMethod}, got ${ctx.json.payment?.method}`);
  }
  return ctx.json.payment;
}

async function stripeLiveSettle(token, amount) {
  const intentRes = await request('POST', `/api/public/rcm/pay/${encodeURIComponent(token)}/create-intent`);
  if (intentRes.status !== 200 || !intentRes.json.client_secret) {
    throw new Error(`create-intent failed: ${JSON.stringify(intentRes.json)}`);
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error('STRIPE_SECRET_KEY required for RCM_E2E_STRIPE_LIVE');

  const stripe = require('stripe')(stripeKey);
  const piId = intentRes.json.payment_intent_id;
  const confirmed = await stripe.paymentIntents.confirm(piId, {
    payment_method: 'pm_card_visa',
    return_url: `${API_BASE}/patients/payment-success.html?rcm=1&token=${encodeURIComponent(token)}`,
  });
  if (confirmed.status !== 'succeeded') {
    throw new Error(`Stripe PI not succeeded: ${confirmed.status}`);
  }
  const complete = await request('POST', `/api/public/rcm/pay/${encodeURIComponent(token)}/complete`, {
    method: 'stripe',
    payment_intent_id: piId,
  });
  if (complete.status !== 200 || !complete.json.success) {
    throw new Error(`complete failed: ${JSON.stringify(complete.json)}`);
  }
  return assertPaid(token, 'stripe');
}

async function usdcLiveSettle(token) {
  const complete = await request('POST', `/api/public/rcm/pay/${encodeURIComponent(token)}/complete`, {
    method: 'usdc',
  });
  if (complete.status !== 200 || !complete.json.success) {
    throw new Error(`USDC complete failed: ${JSON.stringify(complete.json)}`);
  }
  return assertPaid(token, 'usdc');
}

async function main() {
  if (!process.env.RCM_E2E_USE_EXISTING_SERVER) {
    console.error('Start middleware first, then RCM_E2E_USE_EXISTING_SERVER=1');
    process.exit(1);
  }

  const health = await request('GET', '/health');
  if (health.status !== 200) {
    throw new Error(`Middleware not healthy at ${API_BASE}`);
  }

  console.log('Kelly RCM pay gateway E2E');
  console.log('  API:', API_BASE);
  console.log('  Stripe live:', STRIPE_LIVE);
  console.log('  USDC live:', USDC_LIVE);

  const summary = [];

  const kelly1 = await kellyPaymentRequest(10, PATIENT_ID);
  console.log('Kelly tool OK:', kelly1.payment_id, kelly1.pay_url);
  summary.push({ step: 'kelly_request', amount: kelly1.amount, pay_token: kelly1.pay_token.slice(0, 8) + '…' });

  if (STRIPE_LIVE) {
    const paid = await stripeLiveSettle(kelly1.pay_token, kelly1.amount);
    console.log('Stripe live: PAID', paid.stripe_payment_intent_id);
    summary.push({
      rail: 'stripe',
      amount: paid.amount,
      stripe_payment_intent_id: paid.stripe_payment_intent_id,
    });
  } else {
    console.log('Stripe live: skipped (set RCM_E2E_STRIPE_LIVE=1)');
  }

  if (USDC_LIVE) {
    if (!PATIENT_ID) {
      console.warn('USDC live: skipped — set RCM_E2E_PATIENT_ID');
    } else {
      const kelly2 = await kellyPaymentRequest(5, PATIENT_ID);
      const paid = await usdcLiveSettle(kelly2.pay_token);
      console.log('USDC live: PAID', paid.circle_transfer_id);
      summary.push({
        rail: 'usdc',
        amount: paid.amount,
        circle_transfer_id: paid.circle_transfer_id,
      });
    }
  } else {
    console.log('USDC live: skipped (set RCM_E2E_USDC_LIVE=1 + RCM_E2E_PATIENT_ID)');
  }

  console.log('\nSummary:', JSON.stringify(summary, null, 2));
  console.log('\n✅ Kelly RCM pay gateway E2E: PASS');
}

main().catch((err) => {
  console.error('\n❌ Kelly RCM pay gateway E2E: FAIL', err.message);
  process.exit(1);
});
