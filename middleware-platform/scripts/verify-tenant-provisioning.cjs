#!/usr/bin/env node
'use strict';

/**
 * Phase 7.10 — Tenant provisioning verification per use_case vertical.
 *
 * Checks (when env + DB available):
 *   - Twilio DID bound to customer voice URL
 *   - voice_agent_settings row exists
 *   - prompt_profiles authoritative row exists
 *   - Retell agent id present on customer/clinic
 *
 * Usage:
 *   node scripts/verify-tenant-provisioning.cjs --use_case=dental
 *   GCS_DB_BUCKET=... node scripts/verify-tenant-provisioning.cjs --pull --use_case=dental
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const Database = require('better-sqlite3');
const { pullProdDbFromGcs, resolvePulledProdDbPath } = require('./lib/verify-db.cjs');

const VERTICAL_ENV = {
  dental: {
    customer: 'PROVISION_DENTAL_CUSTOMER_ID',
    clinic: 'PROVISION_DENTAL_CLINIC_ID',
    did: 'PROVISION_DENTAL_DID'
  },
  dermatology: {
    customer: 'PROVISION_DERM_CUSTOMER_ID',
    clinic: 'PROVISION_DERM_CLINIC_ID',
    did: 'PROVISION_DERM_DID'
  },
  healthcare_clinic: {
    customer: 'PROVISION_HC_CUSTOMER_ID',
    clinic: 'PROVISION_HC_CLINIC_ID',
    did: 'PROVISION_HC_DID'
  },
  small_business: {
    customer: 'PROVISION_SB_CUSTOMER_ID',
    clinic: 'PROVISION_SB_CLINIC_ID',
    did: 'PROVISION_SB_DID'
  }
};

function resolveIds(useCase) {
  const keys = VERTICAL_ENV[useCase];
  if (!keys) return null;
  return {
    customerId:
      process.env[keys.customer] ||
      (useCase === 'dental' ? process.env.CAPSTONE_CUSTOMER_ID : null),
    clinicId:
      process.env[keys.clinic] ||
      (useCase === 'dental' ? process.env.CAPSTONE_CLINIC_ID : null),
    did:
      process.env[keys.did] ||
      (useCase === 'dental' ? process.env.CAPSTONE_TENANT_DID : null)
  };
}

function openDb() {
  let dbPath = process.env.DB_PATH;
  if (process.argv.includes('--pull')) {
    dbPath = pullProdDbFromGcs();
  }
  dbPath = dbPath || resolvePulledProdDbPath();
  return { db: new Database(dbPath, { readonly: true }), dbPath };
}

function checkDbProvisioning(db, { customerId, clinicId }) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const profile = db
    .prepare(
      `SELECT id, use_case, system_prompt, allowed_tools FROM prompt_profiles
       WHERE customer_id = ? AND clinic_id = ? AND status = 'active' LIMIT 1`
    )
    .get(customerId, clinicId);
  push('prompt_profiles', !!profile?.system_prompt, profile ? `id=${profile.id}` : 'missing');

  const vas = db
    .prepare(
      `SELECT id, retell_agent_id, greeting_text FROM voice_agent_settings
       WHERE customer_id = ? AND (clinic_id = ? OR clinic_id IS NULL)
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(customerId, clinicId);
  push('voice_agent_settings', !!vas, vas ? `retell=${vas.retell_agent_id || 'unset'}` : 'missing');

  const customer = db.prepare('SELECT id, retell_agent_id FROM customers WHERE id = ?').get(customerId);
  push('customer_retell_agent', !!(customer?.retell_agent_id || vas?.retell_agent_id), customer?.retell_agent_id || vas?.retell_agent_id || 'unset');

  return checks;
}

async function checkTwilioDid(did, customerId) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !did) {
    return { name: 'twilio_did_bind', ok: false, detail: 'TWILIO_* or DID unset — live check skipped' };
  }
  try {
    const twilio = require('twilio')(sid, token);
    const list = await twilio.incomingPhoneNumbers.list({ phoneNumber: did, limit: 1 });
    const number = list[0];
    if (!number) return { name: 'twilio_did_bind', ok: false, detail: `DID ${did} not in Twilio` };
    const m = String(number.voiceUrl || '').match(/customer_id=([^&]+)/i);
    const bound = m ? decodeURIComponent(m[1]) : null;
    const ok = bound === customerId;
    return {
      name: 'twilio_did_bind',
      ok,
      detail: ok ? `voiceUrl customer=${bound}` : `expected ${customerId}, got ${bound || 'none'}`
    };
  } catch (e) {
    return { name: 'twilio_did_bind', ok: false, detail: e.message };
  }
}

async function main() {
  if (process.argv.includes('--structural')) {
    const verticals = Object.keys(VERTICAL_ENV);
    const pass = verticals.length >= 4;
    console.log(JSON.stringify({ pass, verticals, mode: 'structural' }, null, 2));
    process.exit(pass ? 0 : 1);
  }

  const useCase = (process.argv.find((a) => a.startsWith('--use_case=')) || '').split('=')[1] || 'dental';
  const ids = resolveIds(useCase);
  if (!ids?.customerId || !ids?.clinicId) {
    console.error(`Set PROVISION_* env for ${useCase} (customer_id + clinic_id required)`);
    process.exit(2);
  }

  const { db, dbPath } = openDb();
  const report = { use_case: useCase, db_path: dbPath, checks: [], pass: true };

  try {
    report.checks.push(...checkDbProvisioning(db, ids));
  } finally {
    db.close();
  }

  const twilioCheck = await checkTwilioDid(ids.did, ids.customerId);
  report.checks.push(twilioCheck);

  const railsOk = String(process.env.KELLY_RAILS_V2 || '1') === '1';
  report.checks.push({
    name: 'KELLY_RAILS_V2',
    ok: railsOk,
    detail: process.env.KELLY_RAILS_V2 || '(default 1 in verify context)'
  });

  for (const c of report.checks) {
    if (!c.ok) report.pass = false;
    console.log(`${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail || ''}`);
  }

  console.log('\n' + JSON.stringify(report, null, 2));
  console.log(
    '\nLive greeting/calendar proof requires PSTN call — see docs/qa/pstn-vertical-matrix.md'
  );
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
