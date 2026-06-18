#!/usr/bin/env node
'use strict';

/**
 * Production acceptance — live cancellation call.
 *
 * Pass: tool_completed cancel_appointment AND appointment status=cancelled.
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
  const sessionId = requireSessionId('scripts/verify-live-cancel-call.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  const cancelTool = findToolCompleted(events, /cancel_appointment/i);

  const appt = db
    .prepare(
      `SELECT id, status, appointment_date, appointment_time, triage_session_id
       FROM appointments
       WHERE triage_session_id = ?
       ORDER BY datetime(created_at) DESC LIMIT 1`
    )
    .get(sessionId);

  const cancelled = String(appt?.status || '').toLowerCase() === 'cancelled';

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    event_count: events.length,
    cancel_tool_completed: cancelTool,
    appointment_id: appt?.id || null,
    appointment_status: appt?.status || null,
    pass: cancelTool && cancelled
  });
}

main();
