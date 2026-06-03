#!/usr/bin/env node
'use strict';

/**
 * RCM golden path — advances all 11 orchestrator stages via /api/rcm/journeys/*
 * Usage: RCM_E2E_USE_EXISTING_SERVER=1 node scripts/e2e-rcm-golden-path.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const https = require('https');

const API_BASE = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = process.env.RCM_E2E_CLINIC_ID || 'clinic-default';
const PROVIDER_EMAIL = process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';
const PROVIDER_PASSWORD = process.env.RCM_E2E_PROVIDER_PASSWORD || 'demo123';
const PATIENT_ID = process.env.RCM_E2E_PATIENT_ID || null;

const STAGES = [
  'pre_registration',
  'registration',
  'charge_capture',
  'prior_authorization',
  'medical_coding',
  'cdi',
  'claim_submission',
  'remittance_processing',
  'follow_up_phone',
  'patient_collection',
  'bill',
];

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
          if (setCookie) {
            cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
          }
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
  console.log('✓ Provider login');
}

async function main() {
  if (!process.env.RCM_E2E_USE_EXISTING_SERVER) {
    console.error('Start server first or use run-rcm-e2e-suite.cjs');
    process.exit(1);
  }

  await login();

  const contract = await request('GET', `/api/rcm/journeys/stage-contract?clinic_id=${CLINIC_ID}`);
  if (!contract.json.success || !Array.isArray(contract.json.stages)) {
    throw new Error('stage-contract failed');
  }
  console.log(`✓ stage-contract (${contract.json.stages.length} stages)`);

  const start = await request('POST', `/api/rcm/journeys/start?clinic_id=${CLINIC_ID}`, {
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    source: 'e2e',
    skip_gates: true,
  });
  if (!start.json.success) throw new Error(start.json.error || 'journeys/start failed');
  const journeyId = start.json.journey_id || start.json.journey?.id;
  console.log(`✓ journey started ${journeyId}`);

  if (PATIENT_ID) {
    await request('POST', `/api/rcm/journeys/${journeyId}/confirm-intake?clinic_id=${CLINIC_ID}`, {
      clinic_id: CLINIC_ID,
      patient_id: PATIENT_ID,
      intake: { e2e: true },
    });
    console.log('✓ confirm-intake');
  }

  for (const stage of STAGES.slice(1)) {
    const ev = await request('POST', `/api/rcm/journeys/${journeyId}/events?clinic_id=${CLINIC_ID}`, {
      clinic_id: CLINIC_ID,
      stage_to: stage,
      event_type: 'e2e_advance',
      skip_gates: true,
      allow_no_eligibility: true,
      allow_no_claim: true,
      allow_no_appointment: true,
    });
    if (!ev.json.success) {
      throw new Error(ev.json.error || `advance to ${stage} failed`);
    }
    console.log(`✓ stage → ${stage}`);
  }

  const close = await request('PATCH', `/api/rcm/journeys/${journeyId}?clinic_id=${CLINIC_ID}`, {
    clinic_id: CLINIC_ID,
    status: 'closed',
  });
  if (!close.json.success) throw new Error(close.json.error || 'close journey failed');
  console.log('✓ journey closed');
  console.log('\nRCM golden path: PASS (11 stages)');
}

main().catch((err) => {
  console.error('\nRCM golden path: FAIL', err.message);
  process.exit(1);
});
