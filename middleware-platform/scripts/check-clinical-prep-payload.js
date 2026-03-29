#!/usr/bin/env node
'use strict';

/**
 * Validate that merged clinical-prep payload prerequisites exist for an appointment:
 * - appointment row
 * - case_summaries row + parseable summary_json
 * - linked triage_sessions row
 * - triage-linked documents in case_report_media for that session_id
 *
 * Usage:
 *   node scripts/check-clinical-prep-payload.js --appointment appt-5f04ffbd3a29
 */

const db = require('../database');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('-')) return fallback;
  return next;
}

function printResult(ok, label, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`[${mark}] ${label}${suffix}`);
}

function main() {
  const appointmentId = argValue('--appointment', process.env.CLINICAL_PREP_APPOINTMENT_ID || 'appt-5f04ffbd3a29');
  if (!appointmentId) {
    console.error('Missing appointment id. Use --appointment <id>.');
    process.exit(2);
  }

  const appt = db.getAppointment ? db.getAppointment(appointmentId) : null;
  const apptOk = !!appt;
  printResult(apptOk, 'appointment exists', appointmentId);
  if (!apptOk) process.exit(1);

  let caseSummaryRow = null;
  try {
    caseSummaryRow = db.db.prepare('SELECT * FROM case_summaries WHERE appointment_id = ? LIMIT 1').get(appointmentId);
  } catch (_) {}
  const csOk = !!caseSummaryRow;
  printResult(csOk, 'case_summary row exists');

  let summary = null;
  if (caseSummaryRow?.summary_json) {
    try {
      summary = typeof caseSummaryRow.summary_json === 'string'
        ? JSON.parse(caseSummaryRow.summary_json)
        : caseSummaryRow.summary_json;
    } catch (_) {}
  }
  const summaryOk = !!summary;
  printResult(summaryOk, 'case_summary JSON parseable');

  const sessionId = caseSummaryRow?.session_id || null;
  const triage = sessionId && db.getTriageSession ? db.getTriageSession(sessionId) : null;
  const triageOk = !!triage;
  printResult(triageOk, 'linked triage_session exists', sessionId || 'no session_id on case summary');

  const docs = sessionId && db.getTriageMediaForSession ? (db.getTriageMediaForSession(sessionId) || []) : [];
  const docsOk = docs.length > 0;
  printResult(docsOk, 'triage-linked documents exist', `count=${docs.length}`);

  const keys = summary && typeof summary === 'object'
    ? ['chief_complaint', 'urgency', 'safety_level', 'soap_note'].filter((k) => summary[k] != null && String(summary[k]).trim() !== '')
    : [];
  printResult(keys.length > 0, 'case_summary has core fields', keys.join(', ') || 'none');

  const allOk = apptOk && csOk && summaryOk && triageOk && docsOk;
  if (!allOk) {
    console.error('\nClinical prep payload check FAILED.');
    process.exit(1);
  }

  console.log('\nClinical prep payload check PASSED.');
}

main();

