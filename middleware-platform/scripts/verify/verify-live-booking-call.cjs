#!/usr/bin/env node
'use strict';

/**
 * Production acceptance check — verify a live call produced schedule_appointment + DB row.
 *
 * Usage:
 *   SESSION_ID=call_xxx DB_PATH=/path/to/prod.db node scripts/verify/verify-live-booking-call.cjs
 *   node scripts/verify/verify-live-booking-call.cjs --session call_xxx
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
  const sessionId = requireSessionId('scripts/verify/verify-live-booking-call.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  const scheduleCompleted = findToolCompleted(events, /schedule_appointment/i);

  const bookingOutcome = events.find((e) => e.event_type === 'booking_outcome');
  let outcomeCode = null;
  if (bookingOutcome) {
    try {
      outcomeCode = JSON.parse(bookingOutcome.payload_json || '{}').error_code || 'booked';
    } catch (_) {}
  }

  const appt = db
    .prepare(
      `SELECT id, status, appointment_date, appointment_time, triage_session_id
       FROM appointments
       WHERE triage_session_id = ?
       ORDER BY datetime(created_at) DESC LIMIT 1`
    )
    .get(sessionId);

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    event_count: events.length,
    schedule_tool_completed: scheduleCompleted,
    booking_outcome: outcomeCode,
    appointment_id: appt?.id || null,
    appointment_status: appt?.status || null,
    appointment_when: appt ? `${appt.appointment_date} ${appt.appointment_time}` : null,
    pass: scheduleCompleted && !!appt?.id
  });
}

main();
