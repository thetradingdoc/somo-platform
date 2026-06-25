#!/usr/bin/env node
'use strict';

/**
 * Set clinic transfer_number on a local DB copy for T-001 prep.
 * Does NOT upload to GCS — operator reviews then uploads or sets Cloud Run env.
 *
 * Usage:
 *   DB_PATH=../backups/middleware-staging.db node scripts/phase1-set-transfer-target.cjs +15551234567
 *   node scripts/phase1-set-transfer-target.cjs +15551234567 --clinic clinic-default
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { canonicalDbPath } = require('./lib/verify-env.cjs');
const Database = require('better-sqlite3');

function normalizeE164(num) {
  const s = String(num || '').trim();
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return s;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const clinicIdx = process.argv.indexOf('--clinic');
  const clinicId = clinicIdx >= 0 ? process.argv[clinicIdx + 1] : 'clinic-default';
  const number = normalizeE164(args[0]);
  if (!number || number.length < 11) {
    console.error('Usage: node scripts/phase1-set-transfer-target.cjs +1XXXXXXXXXX [--clinic clinic-default]');
    process.exit(2);
  }

  const dbPath = canonicalDbPath();
  const db = new Database(dbPath);
  const before = db.prepare('SELECT transfer_number FROM clinics WHERE clinic_id = ?').get(clinicId);
  db.prepare('UPDATE clinics SET transfer_number = ? WHERE clinic_id = ?').run(number, clinicId);
  const after = db.prepare('SELECT transfer_number FROM clinics WHERE clinic_id = ?').get(clinicId);
  db.close();

  console.log(`Updated ${clinicId}.transfer_number: ${before?.transfer_number || '—'} → ${after?.transfer_number}`);
  console.log('');
  console.log('Next (pick one):');
  console.log('  A) Upload DB: see scripts/cloudrun-db-sync.cjs (review guardrails first)');
  console.log('  B) Cloud Run: gcloud run services update somo-middleware --update-env-vars CALLSOMO_OPERATOR_FALLBACK_PSTN=' + number);
}

main();
