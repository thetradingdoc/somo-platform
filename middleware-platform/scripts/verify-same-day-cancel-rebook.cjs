#!/usr/bin/env node
'use strict';

/**
 * CR-032 — Same-day cancel + rebook prod smoke verifier.
 *
 * Pass: cancel_appointment tool_completed, appointment cancelled, then schedule_appointment
 * with new slot same calendar day.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { requireSessionId, openReadonlyDb, fetchKellyEvents, findToolCompleted } = require('./verify-live-shared.cjs');

function main() {
  const sessionId = requireSessionId('scripts/verify-same-day-cancel-rebook.cjs');
  const db = openReadonlyDb();
  const events = fetchKellyEvents(db, sessionId);

  const cancelled = findToolCompleted(events, 'cancel_appointment');
  const rebooked = findToolCompleted(events, 'schedule_appointment');

  const appts = db
    .prepare(
      `SELECT id, status, appointment_date, appointment_time, created_at
       FROM appointments WHERE triage_session_id = ? ORDER BY datetime(created_at) ASC`
    )
    .all(sessionId);

  const cancelledRow = appts.find((a) => String(a.status).toLowerCase() === 'cancelled');
  const activeRow = appts.filter((a) => String(a.status).toLowerCase() !== 'cancelled').pop();

  let sameDay = false;
  if (cancelledRow && activeRow) {
    sameDay = cancelledRow.appointment_date === activeRow.appointment_date;
  }

  const report = {
    session_id: sessionId,
    cancel_tool_completed: cancelled,
    schedule_tool_completed: rebooked,
    cancelled_appointment_id: cancelledRow?.id || null,
    rebooked_appointment_id: activeRow?.id || null,
    same_calendar_day: sameDay,
    pass: cancelled && rebooked && !!cancelledRow && !!activeRow && sameDay
  };

  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(report.pass ? 0 : 1);
}

main();
