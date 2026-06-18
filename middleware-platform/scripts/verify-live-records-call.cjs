#!/usr/bin/env node
'use strict';

/**
 * Production acceptance — live records / chart Q&A call.
 *
 * Pass: tool_completed query_patient_records.
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  fetchKellyEvents,
  findToolCompleted,
  printReportAndExit
} = require('./verify-live-shared.cjs');

function main() {
  const sessionId = requireSessionId('scripts/verify-live-records-call.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  const recordsTool = findToolCompleted(events, /query_patient_records/i);

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    event_count: events.length,
    query_patient_records_completed: recordsTool,
    pass: recordsTool
  });
}

main();
