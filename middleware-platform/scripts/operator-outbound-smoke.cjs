#!/usr/bin/env node
/**
 * Operator outbound smoke — health, DB opener, optional live test call.
 *
 * Usage:
 *   node scripts/operator-outbound-smoke.cjs
 *   API_BASE_URL=https://api.callsomo.com STAGING_DB_PATH=./backups/middleware-staging.db node scripts/operator-outbound-smoke.cjs --live
 *   node scripts/operator-outbound-smoke.cjs --test-call 8622307479
 */
'use strict';

const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const API_BASE = (process.env.API_BASE_URL || 'https://api.callsomo.com').replace(/\/+$/, '');
const LIVE = process.argv.includes('--live');
const testIdx = process.argv.indexOf('--test-call');
const testPhone = testIdx >= 0 ? process.argv[testIdx + 1] : null;

let ok = true;
function pass(msg) {
  console.log(`✅ ${msg}`);
}
function fail(msg) {
  console.error(`❌ ${msg}`);
  ok = false;
}

function httpJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
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

function assertOpenerCopy(text) {
  const t = String(text || '').toLowerCase();
  if (!t.includes('somo')) fail(`outbound_opener missing "Somo": ${text}`);
  else pass('outbound_opener mentions Somo');
  if (/our office|somo owner|part of owner/i.test(t)) {
    fail(`outbound_opener has legacy phrasing: ${text}`);
  } else {
    pass('outbound_opener has no legacy "our office" phrasing');
  }
}

async function main() {
  console.log('=== Operator outbound smoke ===\n');

  const dbPath = process.env.STAGING_DB_PATH || process.env.DB_PATH;
  if (dbPath) {
    process.env.DB_PATH = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
    delete require.cache[require.resolve('../database')];
    const db = require('../database');
    const { getOperatorCustomerId } = require('../services/voice/voice-account-resolution');
    const { resolveVoiceMerchantId } = require('../services/shared/operator-tenant-bootstrap');
    const operatorId = getOperatorCustomerId();
    const customer = operatorId && db.getCustomer(operatorId);
    if (!customer) {
      fail(`Operator customer missing: ${operatorId || '(unset)'}`);
    } else {
      pass(`Operator row: ${operatorId}`);
      const merchantId = resolveVoiceMerchantId(db, customer);
      const settings = db.getVoiceAgentSettingsForProvider({
        merchantId,
        customerId: operatorId
      });
      if (!settings?.outbound_opener) {
        fail('voice_agent_settings.outbound_opener missing');
      } else {
        assertOpenerCopy(settings.outbound_opener);
      }
      if (customer.company_name && !/somo owner/i.test(customer.company_name)) {
        pass(`company_name: ${customer.company_name}`);
      } else {
        fail(`company_name should be Somo, got: ${customer.company_name || '(unset)'}`);
      }
    }
  } else {
    console.warn('⚠️  STAGING_DB_PATH unset — skip DB opener checks');
  }

  if (LIVE || process.argv.includes('--health')) {
    const health = await httpJson(`${API_BASE}/health/voice-operator`);
    if (health.status === 200 && health.json?.ready) {
      pass('Live /health/voice-operator ready');
    } else {
      fail(`/health/voice-operator status=${health.status} ready=${health.json?.ready}`);
      if (health.json?.issues) console.log(health.json.issues);
    }
  }

  if (testPhone) {
    const baseUrl = process.env.TWILIO_OUTBOUND_WEBHOOK_URL || API_BASE;
    const r = spawnSync(
      process.execPath,
      ['scripts/make-outbound-call.js', testPhone],
      {
        stdio: 'inherit',
        env: { ...process.env, TWILIO_OUTBOUND_WEBHOOK_URL: baseUrl }
      }
    );
    if (r.status !== 0) fail('make-outbound-call failed');
    else {
      pass(`Test call placed to ${testPhone}`);
      console.log(
        '\nPass criteria on answer: single opener mentioning Somo; no duplicate Kelly intro.'
      );
      console.log(
        `Cloud Run logs: jsonPayload.event="voice_opener_sent" OR textPayload:voice_opener_sent`
      );
    }
  }

  if (!ok) {
    console.error('\nOperator outbound smoke FAILED');
    process.exit(1);
  }
  console.log('\n✅ Operator outbound smoke passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
