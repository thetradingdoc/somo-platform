#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke: signup → email → assign-line → Twilio number on customer row.
 * Requires: middleware on :4000, TRIAL_SIM_FLOW_ENABLED=1, same DB_PATH as server.
 *
 * Usage:
 *   DB_PATH=./middleware-dev.db TRIAL_SIM_FLOW_ENABLED=1 node scripts/trial-provision-smoke.cjs
 *   TRIAL_E2E_LIVE_TWILIO=1  — expects real Twilio purchase (costs money)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const https = require('https');
const db = require('../database');

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const LIVE =
  process.env.TRIAL_E2E_LIVE_TWILIO === '1' ||
  /api\.callsomo\.com/i.test(API) ||
  process.env.STAGING_REMOTE === '1';
const IS_REMOTE_STAGING = /api\.callsomo\.com/i.test(API) || process.env.STAGING_REMOTE === '1';

function request(method, path, body, cookie, baseUrl = API) {
  return new Promise((resolve, reject) => {
    const url = /^https?:\/\//i.test(path)
      ? new URL(path)
      : new URL(path.startsWith('/') ? path : `/${path}`, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const isNgrok = url.hostname.includes('ngrok');
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(isNgrok ? { 'ngrok-skip-browser-warning': '1' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        },
        timeout: 120000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          let sessionCookie = cookie || '';
          if (setCookie) {
            const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
            const hit = parts.find((c) => c.startsWith('customer_session='));
            if (hit) sessionCookie = hit.split(';')[0];
          }
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json, cookie: sessionCookie });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  if (process.env.TRIAL_SIM_FLOW_ENABLED !== '1' && process.env.TRIAL_SIM_FLOW_ENABLED !== 'true') {
    console.error('Set TRIAL_SIM_FLOW_ENABLED=1 in .env');
    process.exit(1);
  }

  const email = `trial-smoke-${Date.now()}@doclittle.test`;
  const phone =
    process.env.TRIAL_E2E_PHONE ||
    `+1202${String(Math.floor(1000000 + Math.random() * 8999999))}`;

  console.log('API:', API);
  console.log('DB:', process.env.DB_PATH || '(default)');
  console.log('Email:', email);
  console.log('Mobile:', phone);
  console.log('Live Twilio purchase:', LIVE ? 'yes' : 'yes (default — uses real Twilio if configured)');

  let health;
  try {
    health = await request('GET', '/health');
  } catch (e) {
    console.error('Server not reachable:', e.message);
    process.exit(1);
  }
  if (health.status !== 200) {
    console.error('Health check failed:', health.status);
    process.exit(1);
  }

  const apiBase = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  const ngrok = (process.env.NGROK_URL || '').replace(/\/$/, '');
  const needsPublicWebhook = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(apiBase);
  if (needsPublicWebhook && ngrok) {
    try {
      const ng = await request('GET', '/health', null, '', ngrok);
      if (ng.status !== 200) {
        console.warn(`Warning: ${ngrok}/health returned ${ng.status} — restart ngrok or update NGROK_URL`);
      }
    } catch (_) {
      console.error(`ngrok not reachable at ${ngrok}. Run: ngrok http 4000, update NGROK_URL, restart server.`);
      process.exit(1);
    }
  } else if (needsPublicWebhook && !ngrok) {
    console.error('API_BASE_URL is localhost but NGROK_URL is unset. Twilio cannot buy numbers without a public webhook.');
    process.exit(1);
  }

  let cookie = '';
  const signup = await request(
    'POST',
    '/api/signup',
    {
      name: 'Trial Smoke',
      email,
      phone_number: phone,
      customer_type: 'saas',
      company_name: 'Smoke Clinic',
      business_size: '1-10',
      api_features: ['voice_agent']
    },
    cookie
  );
  if (!signup.json?.success) {
    console.error('Signup failed:', signup.status, signup.json);
    process.exit(1);
  }
  const customerId = signup.json.customer_id;
  cookie = signup.cookie || cookie;

  let emailCode = process.env.STAGING_EMAIL_CODE || '';
  if (!emailCode) {
    try {
      const { getEmailCode, resolveDbPath } = require('./staging-db-utils.cjs');
      emailCode = getEmailCode(email);
      console.log('Email code from DB:', resolveDbPath());
    } catch (e) {
      if (IS_REMOTE_STAGING) {
        console.error(
          'Remote staging: set STAGING_DB_PATH (GCS snapshot) or STAGING_EMAIL_CODE for verify-email'
        );
        process.exit(1);
      }
      const codeRow = db.getActiveEmailVerificationCode(email);
      if (!codeRow?.code) {
        console.error('No email verification code in DB');
        process.exit(1);
      }
      emailCode = codeRow.code;
    }
  }

  const verifyEmail = await request(
    'POST',
    '/api/signup/verify-email',
    { email, code: emailCode },
    cookie
  );
  if (!verifyEmail.json?.success) {
    console.error('Email verify failed:', verifyEmail.json);
    process.exit(1);
  }
  cookie = verifyEmail.cookie || cookie;

  const assignLine = await request('POST', '/api/signup/assign-line', { phone_number: phone }, cookie);
  if (!assignLine.json?.success) {
    console.error('Assign line failed:', assignLine.status, assignLine.json);
    process.exit(1);
  }

  let customer;
  try {
    const { getCustomerById } = require('./staging-db-utils.cjs');
    customer = getCustomerById(customerId);
  } catch (_) {
    customer = db.getCustomer(customerId);
  }
  console.log('\n--- Result ---');
  console.log('trial_status:', customer.trial_status);
  console.log('twilio_phone_number:', customer.twilio_phone_number || '(none)');
  console.log('twilio_phone_sid:', customer.twilio_phone_sid || '(none)');
  console.log('trial_expires_at:', customer.trial_expires_at || '(none)');

  if (!customer.twilio_phone_number || customer.trial_status !== 'active') {
    console.error('\nFAIL: expected active trial with dedicated Twilio number');
    process.exit(1);
  }

  console.log('\nOK: trial active with dedicated number', customer.twilio_phone_number);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
