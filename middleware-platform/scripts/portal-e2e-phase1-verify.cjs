#!/usr/bin/env node
'use strict';

/**
 * Verify Phase 1 end state on a prod snapshot.
 *
 * Usage: DB_PATH=../backups/middleware-staging.db node scripts/portal-e2e-phase1-verify.cjs
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { PROTECTED_CUSTOMERS } = require('./portal-e2e-phase1-cleanup.cjs');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'backups', 'middleware-staging.db');
const DOC_LITTLE_CLINIC = process.env.PORTAL_E2E_DOC_LITTLE_CLINIC || 'clinic-doclittle';
const NAV_DID = '+13639990205';
const TENANT_DID = process.env.PORTAL_E2E_TENANT_DID || '+18623622415';

function log(msg) {
  console.log(`[phase1-verify] ${msg}`);
}

function fail(msg) {
  console.error(`[phase1-verify] FAIL ${msg}`);
  process.exit(1);
}

function main() {
  log('=== Phase 1 verify ===');
  if (!fs.existsSync(DB_PATH)) fail(`DB not found: ${DB_PATH}`);

  const db = new Database(DB_PATH, { readonly: true });
  const customers = db.prepare('SELECT id, email, twilio_phone_number FROM customers').all();
  const clinics = db.prepare('SELECT clinic_id, archived_at, is_active FROM clinics').all();

  log(`customers: ${customers.length}`);
  customers.forEach((c) => log(`  ${c.id} ${c.email || ''} did=${c.twilio_phone_number || '-'}`));

  for (const id of PROTECTED_CUSTOMERS) {
    if (!customers.find((c) => c.id === id)) fail(`protected customer missing: ${id}`);
  }
  log(`OK protected customers present`);

  const nav = customers.find((c) => c.id === 'cust-navigation-demo');
  if (!nav?.twilio_phone_number?.includes('3639990205') && nav?.twilio_phone_number !== NAV_DID) {
    log(`WARN navigation-demo DID=${nav?.twilio_phone_number || 'unset'} (expected ${NAV_DID})`);
  } else {
    log(`OK navigation-demo on ${nav.twilio_phone_number}`);
  }

  const junk = customers.filter((c) => {
    if (PROTECTED_CUSTOMERS.has(c.id)) return false;
    const e = (c.email || '').toLowerCase();
    return e.includes('nav@doclittle.example') || e.includes('onboard-e2e') || e.includes('tenant-clinic-');
  });
  if (junk.length) fail(`junk customers remain: ${junk.map((j) => j.id).join(', ')}`);
  log(`OK no junk nav/onboard rows`);

  const docClinic = clinics.find((c) => c.clinic_id === DOC_LITTLE_CLINIC);
  if (docClinic && !docClinic.archived_at) {
    fail(`doclittle clinic not archived`);
  }
  if (docClinic) log(`OK doclittle clinic archived_at=${docClinic.archived_at}`);

  const somo = customers.find((c) => {
    if (PROTECTED_CUSTOMERS.has(c.id)) return false;
    const e = (c.email || '').toLowerCase();
    return e.includes('@somo.') || e.startsWith('somo@') || e.includes('practice.somo');
  });
  if (somo) {
    log(`OK Somo tenant exists: ${somo.id} ${somo.email}`);
  } else {
    log(`PENDING Somo tenant — run PW_MODE=create after upload; Kelly DID ${TENANT_DID}`);
  }

  db.close();
  log('=== Phase 1 verify PASS (Somo slot may be pending) ===');
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  main();
}
