#!/usr/bin/env node
'use strict';

/**
 * RCM money path — payment request → provider mark-paid (or live rails when env set)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const https = require('https');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = process.env.RCM_E2E_CLINIC_ID || 'clinic-default';
const PROVIDER_EMAIL = process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@doclittle.com';
const PROVIDER_PASSWORD = process.env.RCM_E2E_PROVIDER_PASSWORD || 'demo123';
const PATIENT_ID = process.env.RCM_E2E_PATIENT_ID || null;
const AMOUNT = Number(process.env.RCM_E2E_PAY_AMOUNT || 25);

let cookieJar = '';

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
          ...(cookieJar ? { Cookie: cookieJar } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie) cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
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

async function login() {
  const res = await request('POST', '/api/customers/login', {
    email: PROVIDER_EMAIL,
    password: PROVIDER_PASSWORD,
    remember_me: false,
  });
  if (res.status !== 200 || !res.json.success) {
    throw new Error(res.json.error || `Login failed HTTP ${res.status}`);
  }
}

async function main() {
  if (!process.env.RCM_E2E_USE_EXISTING_SERVER) {
    console.error('Start server first or use run-rcm-e2e-suite.cjs');
    process.exit(1);
  }

  await login();

  const start = await request('POST', `/api/rcm/journeys/start?clinic_id=${CLINIC_ID}`, {
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    source: 'e2e_money',
    skip_gates: true,
  });
  const journeyId = start.json.journey_id || start.json.journey?.id;
  if (!journeyId) throw new Error('journey start failed');

  await request('POST', `/api/rcm/journeys/${journeyId}/events?clinic_id=${CLINIC_ID}`, {
    clinic_id: CLINIC_ID,
    stage_to: 'patient_collection',
    skip_gates: true,
  });

  const payReq = await request('POST', `/api/rcm/payments/request?clinic_id=${CLINIC_ID}`, {
    clinic_id: CLINIC_ID,
    journey_id: journeyId,
    patient_id: PATIENT_ID,
    amount: AMOUNT,
  });
  if (!payReq.json.success || !payReq.json.payment_id) {
    throw new Error(payReq.json.error || 'payments/request failed');
  }
  console.log('✓ payment requested', payReq.json.payment_id);
  if (payReq.json.pay_url) console.log('  pay_url:', payReq.json.pay_url);

  const token = payReq.json.pay_token;
  if (process.env.RCM_E2E_STRIPE_LIVE === '1' && token) {
    const ctx = await request('GET', `/api/public/rcm/pay/${token}`);
    if (!ctx.json.success) throw new Error(ctx.json.error || 'public pay context failed');
    console.log('  rails.card.available:', ctx.json.rails?.card?.available);
  } else if (process.env.RCM_E2E_USDC_LIVE === '1' && token) {
    const complete = await request('POST', `/api/public/rcm/pay/${token}/complete`, {
      method: 'usdc',
    });
    if (!complete.json.success) {
      throw new Error(complete.json.error || 'USDC complete failed');
    }
    console.log('✓ USDC settled');
  } else {
    const paid = await request(
      'POST',
      `/api/rcm/payments/${payReq.json.payment_id}/mark-paid?clinic_id=${CLINIC_ID}`,
      { clinic_id: CLINIC_ID, method: 'manual' }
    );
    if (!paid.json.success) throw new Error(paid.json.error || 'mark-paid failed');
    console.log('✓ provider mark-paid');
  }

  const list = await request('GET', `/api/rcm/payments?clinic_id=${CLINIC_ID}`);
  const row = (list.json.payments || []).find((p) => p.id === payReq.json.payment_id);
  if (!row || row.status !== 'paid') {
    throw new Error('paid row not visible in GET /api/rcm/payments');
  }
  console.log('✓ provider payments list shows paid');
  console.log('\nRCM money path: PASS');
}

main().catch((err) => {
  console.error('\nRCM money path: FAIL', err.message);
  process.exit(1);
});
