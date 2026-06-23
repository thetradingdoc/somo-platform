#!/usr/bin/env node
/**
 * SITE-23 / R-07: Backfill clinic_id / customer_id on projection + triage + session_state.
 *
 * Sources: call_site_context, voice_call_log, patient_orchestrate_sessions, kelly_call_events
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/data/backfill-site-context-tenant-columns.cjs --dry-run
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Database = require('better-sqlite3');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'var/db/middleware-dev.db');
const dryRun = process.argv.includes('--dry-run');

const db = new Database(dbPath, { readonly: dryRun });

function hasColumn(table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (_) {
    return false;
  }
}

function tableExists(table) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

function updatePair(table, sessionId, clinicId, customerId) {
  if (!tableExists(table) || !hasColumn(table, 'clinic_id')) return 0;
  if (dryRun) return 1;
  const r = db
    .prepare(
      `UPDATE ${table}
       SET clinic_id = COALESCE(clinic_id, ?), customer_id = COALESCE(customer_id, ?)
       WHERE session_id = ? AND clinic_id IS NULL`
    )
    .run(clinicId, customerId, sessionId);
  return r.changes;
}

const siteRows = tableExists('call_site_context')
  ? db
      .prepare(
        `SELECT session_id, clinic_id, customer_id
         FROM call_site_context
         WHERE clinic_id IS NOT NULL AND session_id IS NOT NULL`
      )
      .all()
  : [];

let proj = 0;
let triage = 0;
let sessionState = 0;

for (const row of siteRows) {
  proj += updatePair('kelly_rails_session_projection', row.session_id, row.clinic_id, row.customer_id);
  triage += updatePair('triage_sessions', row.session_id, row.clinic_id, row.customer_id);
  sessionState += updatePair('session_state_projection', row.session_id, row.clinic_id, row.customer_id);
}

if (tableExists('voice_call_log') && hasColumn('voice_call_log', 'clinic_id')) {
  const sessionCol = hasColumn('voice_call_log', 'session_id') ? 'session_id' : 'call_id';
  const voiceRows = db
    .prepare(
      `SELECT ${sessionCol} AS session_id, clinic_id, customer_id
       FROM voice_call_log
       WHERE clinic_id IS NOT NULL AND ${sessionCol} IS NOT NULL`
    )
    .all();
  for (const row of voiceRows) {
    proj += updatePair('kelly_rails_session_projection', row.session_id, row.clinic_id, row.customer_id);
    triage += updatePair('triage_sessions', row.session_id, row.clinic_id, row.customer_id);
    sessionState += updatePair('session_state_projection', row.session_id, row.clinic_id, row.customer_id);
  }
}

if (tableExists('patient_orchestrate_sessions')) {
  const orchRows = db
    .prepare(
      `SELECT session_id, clinic_id, json_extract(flow_state, '$.customer_id') AS customer_id
       FROM patient_orchestrate_sessions
       WHERE clinic_id IS NOT NULL AND session_id IS NOT NULL`
    )
    .all();
  for (const row of orchRows) {
    proj += updatePair('kelly_rails_session_projection', row.session_id, row.clinic_id, row.customer_id);
    triage += updatePair('triage_sessions', row.session_id, row.clinic_id, row.customer_id);
  }
}

if (tableExists('kelly_call_events')) {
  const eventRows = db
    .prepare(
      `SELECT session_id, clinic_id, customer_id
       FROM kelly_call_events
       WHERE clinic_id IS NOT NULL AND session_id IS NOT NULL
       GROUP BY session_id`
    )
    .all();
  for (const row of eventRows) {
    proj += updatePair('kelly_rails_session_projection', row.session_id, row.clinic_id, row.customer_id);
    triage += updatePair('triage_sessions', row.session_id, row.clinic_id, row.customer_id);
    sessionState += updatePair('session_state_projection', row.session_id, row.clinic_id, row.customer_id);
  }
}

let caseRecords = 0;
if (tableExists('case_records') && hasColumn('case_records', 'clinic_id')) {
  const caseRows = db
    .prepare(
      `SELECT cr.session_id, pos.clinic_id, json_extract(pos.flow_state, '$.customer_id') AS customer_id
       FROM case_records cr
       JOIN patient_orchestrate_sessions pos ON pos.session_id = cr.session_id
       WHERE cr.clinic_id IS NULL AND pos.clinic_id IS NOT NULL`
    )
    .all();
  for (const row of caseRows) {
    if (dryRun) caseRecords += 1;
    else {
      const r = db
        .prepare(
          `UPDATE case_records
           SET clinic_id = COALESCE(clinic_id, ?), customer_id = COALESCE(customer_id, ?)
           WHERE session_id = ? AND clinic_id IS NULL`
        )
        .run(row.clinic_id, row.customer_id, row.session_id);
      caseRecords += r.changes;
    }
  }
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}backfill complete: projection=${proj}, triage=${triage}, session_state=${sessionState}, case_records=${caseRecords} (site_context rows=${siteRows.length})`
);
