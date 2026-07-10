#!/usr/bin/env node
'use strict';

/**
 * Assert Twilio voice URL for tenant DID points at expected customer_id.
 *
 * Usage:
 *   node scripts/portal-e2e-did-verify.cjs
 *   node scripts/portal-e2e-did-verify.cjs --customer_id=cust_xxx
 *
 * Env:
 *   PORTAL_E2E_TENANT_DID=+18623622415
 *   PORTAL_E2E_TWILIO_PHONE_SID=PN...  (optional; searches by number)
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *   MIDDLEWARE_API_BASE / API_BASE_URL
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MP = path.join(__dirname, '..');
const TENANT_DID = (process.env.PORTAL_E2E_TENANT_DID || '+18623622415').replace(/\s/g, '');
const API_BASE = (
  process.env.MIDDLEWARE_API_BASE ||
  process.env.API_BASE_URL ||
  'https://api.callsomo.com'
).replace(/\/+$/, '');

function resolveApiBase() {
  const deployProd =
    process.env.DEPLOY_INTENT === 'production' ||
    process.env.PW_ENV === 'production' ||
    process.argv.includes('--production');
  const raw = API_BASE;
  if (deployProd && /^http:\/\/(localhost|127\.)/i.test(raw)) {
    return 'https://api.callsomo.com';
  }
  return raw;
}

const EFFECTIVE_API_BASE = resolveApiBase();

function log(msg) {
  console.log(`[did-verify] ${msg}`);
}

function fail(msg) {
  console.error(`[did-verify] FAIL ${msg}`);
  process.exit(1);
}

function extractCustomerId(voiceUrl) {
  if (!voiceUrl) return null;
  const m = String(voiceUrl).match(/customer_id=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function parseArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

async function main() {
  log('=== DID bind verification ===');
  log(`target DID: ${TENANT_DID}`);
  log(`expected API base: ${EFFECTIVE_API_BASE}`);

  const expectedCustomer =
    parseArg('customer_id') ||
    process.env.PORTAL_E2E_SOMO_CUSTOMER_ID ||
    (() => {
      try {
        const statePath = path.join(MP, 'test-results', 'portal-e2e', 'somo-create-state.json');
        const fs = require('fs');
        if (fs.existsSync(statePath)) {
          return JSON.parse(fs.readFileSync(statePath, 'utf8')).customer_id;
        }
      } catch {
        /* ignore */
      }
      return process.env.CAPSTONE_CUSTOMER_ID || null;
    })();

  if (!expectedCustomer) {
    fail('No expected customer_id — set --customer_id, PORTAL_E2E_SOMO_CUSTOMER_ID, or complete Somo create state');
  }
  log(`expected customer_id: ${expectedCustomer}`);

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) fail('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required');

  const twilio = require(path.join(MP, 'node_modules', 'twilio'))(sid, token);
  const phoneSid = process.env.PORTAL_E2E_TWILIO_PHONE_SID || process.env.TWILIO_TENANT_PHONE_SID;

  let number;
  if (phoneSid) {
    number = await twilio.incomingPhoneNumbers(phoneSid).fetch();
  } else {
    const list = await twilio.incomingPhoneNumbers.list({ phoneNumber: TENANT_DID, limit: 5 });
    number = list[0];
    if (!number) {
      const all = await twilio.incomingPhoneNumbers.list({ limit: 50 });
      number = all.find((n) => n.phoneNumber === TENANT_DID);
    }
  }

  if (!number) fail(`Twilio number not found for ${TENANT_DID}`);

  log(`Twilio number: ${number.phoneNumber} (${number.sid})`);
  log(`voiceUrl: ${number.voiceUrl || '(unset)'}`);
  log(`statusCallback: ${number.statusCallback || '(unset)'}`);

  const actualCustomer = extractCustomerId(number.voiceUrl);
  const expectedVoicePrefix = `${EFFECTIVE_API_BASE}/voice/incoming?customer_id=${encodeURIComponent(expectedCustomer)}`;

  if (actualCustomer !== expectedCustomer) {
    fail(`customer_id mismatch: got ${actualCustomer || '(none)'}, expected ${expectedCustomer}`);
  }
  if (!String(number.voiceUrl || '').startsWith(`${EFFECTIVE_API_BASE}/voice/incoming`)) {
    fail(`voice URL host/path mismatch: ${number.voiceUrl}`);
  }

  log(`OK voice URL matches ${expectedCustomer}`);
  log('=== DID verify PASS ===');

  const outPath = path.join(MP, 'test-results', 'portal-e2e', 'did-verify.json');
  const fs = require('fs');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        phone: number.phoneNumber,
        sid: number.sid,
        voiceUrl: number.voiceUrl,
        customer_id: actualCustomer,
        pass: true
      },
      null,
      2
    )
  );
  log(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
