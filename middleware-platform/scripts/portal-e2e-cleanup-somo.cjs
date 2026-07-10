#!/usr/bin/env node
'use strict';

/**
 * Remove tagged Playwright test data from Somo tenant (prod reuse hygiene).
 *
 * Usage:
 *   node scripts/portal-e2e-cleanup-somo.cjs           # dry-run
 *   node scripts/portal-e2e-cleanup-somo.cjs --execute
 *
 * Env: DB_PATH, PORTAL_E2E_SOMO_CUSTOMER_ID (or somo-create-state.json)
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const MAX_AGE_DAYS = Number(process.env.PORTAL_E2E_CLEANUP_DAYS || 7);
const EXECUTE = process.argv.includes('--execute');

function log(msg) {
  console.log(`[portal-e2e-cleanup] ${msg}`);
}

function resolveCustomerId() {
  if (process.env.PORTAL_E2E_SOMO_CUSTOMER_ID) return process.env.PORTAL_E2E_SOMO_CUSTOMER_ID;
  const statePath = path.join(__dirname, '..', 'test-results', 'portal-e2e', 'somo-create-state.json');
  if (fs.existsSync(statePath)) {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (st.customer_id) return st.customer_id;
  }
  return null;
}

function main() {
  const customerId = resolveCustomerId();
  if (!customerId) {
    console.error('Set PORTAL_E2E_SOMO_CUSTOMER_ID or complete Somo create');
    process.exit(2);
  }

  log(`customer_id=${customerId} max_age_days=${MAX_AGE_DAYS} execute=${EXECUTE}`);
  log(`database: ${db.sqliteDatabasePath || process.env.DB_PATH || '(default)'}`);

  const cutoff = `datetime('now', '-${MAX_AGE_DAYS} days')`;

  const e2ePatients = db.db
    .prepare(
      `SELECT patient_id, name, created_at FROM fhir_patients
       WHERE customer_id = ? AND (name LIKE '[E2E]%' OR name LIKE '%e2e%')
       AND created_at < ${cutoff}`
    )
    .all(customerId);

  const e2eAppts = db.db
    .prepare(
      `SELECT appointment_id, notes, created_at FROM appointments
       WHERE customer_id = ? AND (notes LIKE '%e2e-run%' OR notes LIKE '%playwright%')
       AND created_at < ${cutoff}`
    )
    .all(customerId);

  log(`found ${e2ePatients.length} stale e2e patients`);
  e2ePatients.forEach((p) => log(`  patient ${p.patient_id} ${p.name} (${p.created_at})`));
  log(`found ${e2eAppts.length} stale e2e appointments`);
  e2eAppts.forEach((a) => log(`  appt ${a.appointment_id} (${a.created_at})`));

  if (!EXECUTE) {
    log('dry-run only — pass --execute to delete');
    return;
  }

  const tx = db.db.transaction(() => {
    for (const a of e2eAppts) {
      db.db.prepare('DELETE FROM appointments WHERE appointment_id = ?').run(a.appointment_id);
    }
    for (const p of e2ePatients) {
      db.db.prepare('DELETE FROM fhir_patients WHERE patient_id = ?').run(p.patient_id);
    }
  });
  tx();
  log(`deleted ${e2eAppts.length} appointments, ${e2ePatients.length} patients`);
}

main();
