#!/usr/bin/env node
'use strict';

/**
 * Print Phase 1 DID / transfer inventory from pulled prod DB.
 * Usage: DB_PATH=../backups/middleware-staging.db node scripts/phase1-did-inventory.cjs
 */

const path = require('path');
const fs = require('fs');

const defaultProd = path.join(__dirname, '..', '..', 'backups', 'middleware-staging.db');
if (!process.env.DB_PATH && fs.existsSync(defaultProd)) {
  process.env.DB_PATH = defaultProd;
}

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (fs.existsSync(defaultProd)) {
  process.env.DB_PATH = defaultProd;
}

const { canonicalDbPath } = require('./lib/verify-env.cjs');

const PLATFORM_DID =
  process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER ||
  process.env.TWILIO_PHONE_NUMBER ||
  '+13639990205';
const TENANT_DID_HINT = process.env.CAPSTONE_TENANT_DID || process.env.PHASE1_TENANT_DID || '+18623622415';
const OPERATOR_ID =
  process.env.CALLSOMO_OPERATOR_CUSTOMER_ID ||
  process.env.CALLSOMO_VOICE_CUSTOMER_ID ||
  'cust_b7c7d3e1-31e6-4fbb-b6fd-8e306a79fad8';

function main() {
  const dbPath = canonicalDbPath();
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  console.log('=== Phase 1 DID inventory ===');
  console.log('DB:', dbPath);
  console.log('Cloud Run revision (set manually): somo-middleware-00114-f69');
  console.log('Image tag: gcr.io/somo-callsomo/somo-middleware:6cdfda9');
  console.log('');
  console.log('| Role | Number | Notes |');
  console.log('|------|--------|-------|');
  console.log(`| Platform demo | ${PLATFORM_DID} | PD-4 demo world |`);
  console.log(`| Tenant DID (env hint) | ${TENANT_DID_HINT} | CAPSTONE_TENANT_DID / Twilio voice URL |`);
  console.log(
    `| Transfer fallback (env) | ${process.env.CALLSOMO_OPERATOR_FALLBACK_PSTN || '(not set — use clinic transfer_number)'} | T-001 ring target |`
  );

  const op = db.prepare('SELECT id, email, twilio_phone_number, customer_type FROM customers WHERE id = ?').get(
    OPERATOR_ID
  );
  if (op) {
    console.log(
      `| Operator customer | ${op.twilio_phone_number || '(no DID on row)'} | ${op.email} (${op.customer_type}) |`
    );
  }

  const withDid = db
    .prepare(
      `SELECT id, email, twilio_phone_number, customer_type FROM customers
       WHERE twilio_phone_number IS NOT NULL AND trim(twilio_phone_number) != ''`
    )
    .all();
  if (withDid.length) {
    console.log('');
    console.log('Customers with Twilio DID:');
    for (const r of withDid) {
      console.log(`  - ${r.twilio_phone_number}  ${r.email}  (${r.id})`);
    }
  } else {
    console.log('');
    console.log('No customers.twilio_phone_number rows — tenant inbound uses Twilio voice URL customer_id param.');
  }

  const clinics = db
    .prepare(
      `SELECT clinic_id, name, transfer_number, fallback_pstn, phone_number FROM clinics ORDER BY clinic_id LIMIT 20`
    )
    .all();
  if (clinics.length) {
    console.log('');
    console.log('Clinics (transfer for T-001):');
    for (const c of clinics) {
      console.log(
        `  - ${c.clinic_id}: transfer=${c.transfer_number || '—'} fallback=${c.fallback_pstn || '—'} main=${c.phone_number || '—'}`
      );
    }
  }

  console.log('');
  console.log('T-001: Set clinics.transfer_number to your mobile OR Cloud Run CALLSOMO_OPERATOR_FALLBACK_PSTN');
  console.log('Staging note: prod service has STAGING=1 — use tenant DID from Twilio console voice URL.');
  db.close();
}

main();
