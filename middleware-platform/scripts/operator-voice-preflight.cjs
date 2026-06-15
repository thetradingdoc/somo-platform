#!/usr/bin/env node
/**
 * Operator voice preflight — DB fingerprint, duplicates, FK, config triplet, resolution paths.
 *
 * Usage:
 *   STAGING_DB_PATH=./backups/middleware-staging.db node scripts/operator-voice-preflight.cjs
 *   STAGING_DB_PATH=./backups/middleware-staging.db API_BASE_URL=https://api.callsomo.com node scripts/operator-voice-preflight.cjs --live-api
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const { resolveVoiceAccount, getOperatorCustomerId } = require('../services/voice-account-resolution');

const API_BASE = (process.env.API_BASE_URL || 'https://api.callsomo.com').replace(/\/+$/, '');
const LIVE_API = process.argv.includes('--live-api');
const OPERATOR_ID =
  process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
  process.env.CALLSOMO_VOICE_CUSTOMER_ID ||
  'cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8';
const PLATFORM_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+13639990205';

let ok = true;
function pass(msg) {
  console.log(`✅ ${msg}`);
}
function fail(msg) {
  console.error(`❌ ${msg}`);
  ok = false;
}
function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

function httpJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, json: null, body });
        }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });
  });
}

function loadStagingDb() {
  const dbPath = process.env.STAGING_DB_PATH || process.env.DB_PATH;
  if (!dbPath) {
    fail('STAGING_DB_PATH or DB_PATH required');
    return null;
  }
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
  if (!fs.existsSync(resolved)) {
    fail(`Database not found: ${resolved}`);
    return null;
  }
  process.env.DB_PATH = resolved;
  delete require.cache[require.resolve('../database')];
  return require('../database');
}

async function main() {
  console.log('=== Operator Voice Preflight ===\n');

  const backupList = spawnSync(
    'gsutil',
    ['ls', 'gs://somo-staging-db-somo-callsomo/backups/'],
    { encoding: 'utf8' }
  );
  if (backupList.status === 0 && backupList.stdout.trim()) {
    pass('GCS rollback backups present');
  } else {
    warn('GCS rollback backups not listed (run gsutil cp to backups/ before prod edits)');
  }

  const {
    dbFingerprint,
    listOperators,
    duplicateEmailGroups,
    foreignKeyCheck
  } = require('./staging-db-utils.cjs');

  let fingerprint;
  try {
    fingerprint = dbFingerprint();
    console.log('DB fingerprint:', JSON.stringify(fingerprint, null, 2));
    pass('DB fingerprint collected');
  } catch (e) {
    fail(`DB fingerprint: ${e.message}`);
  }

  const operators = listOperators();
  if (operators.length === 0) {
    fail('No operator rows (customer_type=operator)');
  } else if (operators.length > 1) {
    fail(`${operators.length} operator rows — consolidate to one`);
    console.log(operators);
  } else {
    pass(`Single operator row: ${operators[0].id}`);
  }

  const dupEmails = duplicateEmailGroups();
  if (dupEmails.length) {
    fail(`${dupEmails.length} duplicate customer emails`);
    console.log(dupEmails);
  } else {
    pass('No duplicate customer emails');
  }

  const fk = foreignKeyCheck();
  if (fk && fk.error) {
    warn(`PRAGMA foreign_key_check: ${fk.error}`);
  } else if (Array.isArray(fk) && fk.length > 0) {
    fail(`${fk.length} foreign key violations`);
    console.log(fk.slice(0, 5));
  } else {
    pass('No foreign key violations');
  }

  const db = loadStagingDb();
  if (db) {
    const row = db.getCustomer(OPERATOR_ID);
    if (!row) fail(`Operator ID ${OPERATOR_ID} missing from DB`);
    else pass(`Operator row present: ${OPERATOR_ID}`);

    const credits = db.getCustomerCredits(OPERATOR_ID);
    if (!credits) fail(`customer_credits missing for ${OPERATOR_ID}`);
    else pass('customer_credits row present');

    const mockDb = {
      getCustomer: (id) => db.getCustomer(id),
      getCustomerByTwilioNumber: (n) => db.getCustomerByTwilioNumber(n),
      getClinicPhoneNumber: (n) => db.getClinicPhoneNumber(n),
      getCustomerIdForClinic: (cid) => db.getCustomerIdForClinic?.(cid),
      db: db.db
    };

    const pathA = resolveVoiceAccount(mockDb, { query: { customer_id: OPERATOR_ID }, headers: {} }, {
      normalizedToNumber: PLATFORM_NUMBER,
      isSomoDemoDemo: false,
      isOutbound: true,
      leadId: null
    });
    if (pathA.customerId === OPERATOR_ID) pass('Resolution path A (URL customer_id)');
    else fail(`Resolution path A failed: got ${pathA.customerId}`);

    const pathB = resolveVoiceAccount(mockDb, { query: {}, headers: {} }, {
      normalizedToNumber: PLATFORM_NUMBER,
      isSomoDemoDemo: false,
      isOutbound: false,
      leadId: null
    });
    if (pathB.customerId) pass(`Resolution path B (To number): ${pathB.customerId}`);
    else warn('Resolution path B (To number) — no match (OK if platform line not on customers.twilio_phone_number)');

    const prevOp = process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID = OPERATOR_ID;
    const pathC = resolveVoiceAccount(mockDb, { query: { call_type: 'operator_outbound' }, body: {}, headers: {} }, {
      normalizedToNumber: PLATFORM_NUMBER,
      isSomoDemoDemo: false,
      isOutbound: true,
      leadId: null
    });
    if (pathC.customerId === OPERATOR_ID) pass('Resolution path C (operator env fallback)');
    else fail(`Resolution path C failed: got ${pathC.customerId}`);
    if (prevOp) process.env.CALLSOMO_OPERATOR_CUSTOMER_ID = prevOp;
    else delete process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
  }

  const envId = getOperatorCustomerId();
  if (envId === OPERATOR_ID) pass(`Local env CALLSOMO_OPERATOR_CUSTOMER_ID matches ${OPERATOR_ID}`);
  else fail(`Local env operator ID mismatch: ${envId || '(unset)'}`);

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const sid =
        process.env.STAGING_OWNER_TWILIO_SID ||
        process.env.TWILIO_PHONE_SID ||
        'PNa74666cb828d4fa385df5d74292fd18e';
      const n = await twilio.incomingPhoneNumbers(sid).fetch();
      const urlId = (n.voiceUrl || '').match(/customer_id=([^&]+)/i)?.[1];
      if (decodeURIComponent(urlId || '') === OPERATOR_ID) {
        pass('Twilio voice URL customer_id matches');
      } else {
        fail(`Twilio voice URL customer_id=${urlId || '(none)'} expected ${OPERATOR_ID}`);
      }
      const expectedStatus = `${API_BASE}/voice/status-callback`;
      if ((n.statusCallback || '').replace(/\/+$/, '') === expectedStatus) {
        pass('Twilio statusCallback URL correct');
      } else {
        warn(`Twilio statusCallback=${n.statusCallback || '(unset)'} expected ${expectedStatus}`);
      }
      for (const cb of [n.voiceUrl, n.statusCallback, n.voiceFallbackUrl]) {
        if (cb && /ngrok|localhost|127\.0\.0\.1/i.test(cb)) {
          fail(`Twilio callback points to local/ngrok: ${cb}`);
        }
      }
    } catch (e) {
      warn(`Twilio check skipped: ${e.message}`);
    }
  } else {
    warn('Twilio credentials missing — skip Twilio URL checks');
  }

  if (process.env.RETELL_API_KEY) {
    const agentId = process.env.RETELL_AGENT_ID || process.env.RETELL_SALES_AGENT_ID;
    if (agentId) {
      const RetellService = require('../services/retell-service');
      const svc = new RetellService();
      const agent = await svc.getAgent(agentId);
      if (agent.success) pass(`Retell agent ${agentId} exists`);
      else fail(`Retell agent ${agentId}: ${agent.error}`);
    } else {
      fail('RETELL_AGENT_ID not set');
    }
  } else {
    warn('RETELL_API_KEY missing — skip Retell agent check');
  }

  const gcloud = spawnSync(
    'gcloud',
    [
      'run',
      'services',
      'describe',
      'somo-middleware',
      '--region=us-central1',
      '--format=json'
    ],
    { encoding: 'utf8' }
  );
  if (gcloud.status === 0 && gcloud.stdout) {
    try {
      const svc = JSON.parse(gcloud.stdout);
      const tmpl = svc.spec?.template?.metadata?.annotations || {};
      const minInst = tmpl['autoscaling.knative.dev/minScale'] || '?';
      const maxInst = tmpl['autoscaling.knative.dev/maxScale'] || '?';
      const concurrency = svc.spec?.template?.spec?.containerConcurrency || '?';
      console.log(`Cloud Run: min=${minInst} max=${maxInst} concurrency=${concurrency}`);
      if (maxInst !== '1' && maxInst !== 1) {
        warn(`max-instances=${maxInst} — SQLite GCS sync risks stale DB on multiple instances`);
      } else {
        pass('Cloud Run max-instances=1 (SQLite safe)');
      }
      const envVars = svc.spec?.template?.spec?.containers?.[0]?.env || [];
      const crOp = envVars.find((e) => e.name === 'CALLSOMO_OPERATOR_CUSTOMER_ID')?.value;
      if (crOp === OPERATOR_ID) pass('Cloud Run CALLSOMO_OPERATOR_CUSTOMER_ID matches');
      else fail(`Cloud Run operator ID: ${crOp || '(unset)'}`);
    } catch (e) {
      warn(`Cloud Run parse: ${e.message}`);
    }
  } else {
    warn('gcloud not available — skip Cloud Run scaling check');
  }

  console.log('\n==> operator-billing-smoke');
  const smoke = spawnSync(process.execPath, ['scripts/operator-billing-smoke.cjs'], {
    stdio: 'inherit',
    env: { ...process.env, STAGING_DB_PATH: process.env.STAGING_DB_PATH || process.env.DB_PATH }
  });
  if (smoke.status !== 0) ok = false;

  if (LIVE_API) {
    console.log('\n==> Live API /health/voice-operator');
    const live = await httpJson(`${API_BASE}/health/voice-operator`);
    if (live.status === 200 && live.json?.ready) {
      pass('Live /health/voice-operator ready');
      if (fingerprint && live.json.db_fingerprint) {
        const local = fingerprint;
        const remote = live.json.db_fingerprint;
        if (local.customer_count === remote.customer_count) {
          pass('Live customer_count matches local fingerprint');
        } else {
          fail(
            `Fingerprint mismatch: local customers=${local.customer_count} live=${remote.customer_count}`
          );
        }
      }
    } else {
      fail(`Live /health/voice-operator status=${live.status} ready=${live.json?.ready}`);
      if (live.json?.issues) console.log(live.json.issues);
    }
  }

  if (!ok) {
    console.error('\nPreflight FAILED');
    process.exit(1);
  }
  console.log('\n✅ Operator voice preflight passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
