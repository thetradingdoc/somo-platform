#!/usr/bin/env node
'use strict';

/**
 * Production acceptance — live reschedule call.
 *
 * Pass: tool_completed reschedule_appointment AND appointment has new date/time.
 *
 * Optional env:
 *   EXPECTED_DATE=2026-06-20 EXPECTED_TIME=14:00
 *   ORIGINAL_DATE=2026-06-18 ORIGINAL_TIME=10:00  (pass if date/time changed from original)
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  fetchKellyEvents,
  findToolCompleted,
  printReportAndExit
} = require('./verify-live-shared');

function main() {
  const sessionId = requireSessionId('scripts/verify/verify-live-reschedule-call.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  const rescheduleTool = findToolCompleted(events, /reschedule_appointment/i);

  const appt = db
    .prepare(
      `SELECT id, status, appointment_date, appointment_time, triage_session_id
       FROM appointments
       WHERE triage_session_id = ?
       ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1`
    )
    .get(sessionId);

  const expectedDate = String(process.env.EXPECTED_DATE || '').trim();
  const expectedTime = String(process.env.EXPECTED_TIME || '').trim();
  const originalDate = String(process.env.ORIGINAL_DATE || '').trim();
  const originalTime = String(process.env.ORIGINAL_TIME || '').trim();

  let datetimeOk = false;
  if (appt?.appointment_date && appt?.appointment_time) {
    if (expectedDate && expectedTime) {
      datetimeOk = appt.appointment_date === expectedDate && appt.appointment_time === expectedTime;
    } else if (originalDate || originalTime) {
      datetimeOk =
        (originalDate && appt.appointment_date !== originalDate) ||
        (originalTime && appt.appointment_time !== originalTime);
    } else {
      datetimeOk = true;
    }
  }

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    event_count: events.length,
    reschedule_tool_completed: rescheduleTool,
    appointment_id: appt?.id || null,
    appointment_when: appt ? `${appt.appointment_date} ${appt.appointment_time}` : null,
    datetime_ok: datetimeOk,
    pass: rescheduleTool && datetimeOk
  });
}

main();
