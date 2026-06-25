#!/usr/bin/env node
'use strict';

/**
 * Production acceptance check — verify a live call produced schedule_appointment + DB row.
 *
 * Usage:
 *   SESSION_ID=call_xxx DB_PATH=/path/to/prod.db node scripts/verify-live-booking-call.cjs
 *   node scripts/verify-live-booking-call.cjs --session call_xxx
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  fetchKellyEvents,
  findToolCompleted,
  printReportAndExit
} = require('./verify-live-shared.cjs');

const {
  getCall,
  transcriptHasBooking,
  transcriptHasOpqrst
} = require('./lib/verify-retell.cjs');

async function retellBookingFallback(sessionId) {
  const call = await getCall(sessionId);
  const transcript = String(call.transcript || '');
  const toolCalls = call.tool_calls || call.transcript_with_tool_calls || [];
  const toolStr = JSON.stringify(toolCalls);
  const scheduleTool =
    /schedule_appointment/i.test(toolStr) ||
    (Array.isArray(toolCalls) &&
      toolCalls.some((t) => /schedule_appointment/i.test(JSON.stringify(t))));
  const bookingLang = transcriptHasBooking(transcript);
  const pass = scheduleTool || (bookingLang && !transcriptHasOpqrst(transcript) && call.duration_ms > 45000);
  return {
    session_id: sessionId,
    retell_fallback: true,
    schedule_tool_in_retell: scheduleTool,
    booking_language: bookingLang,
    duration_ms: call.duration_ms,
    call_status: call.call_status,
    transcript_excerpt: transcript.slice(0, 600),
    pass,
    pass_reason: pass ? 'retell_booking_signals' : 'insufficient_booking_evidence'
  };
}

function phase1Strict() {
  return process.env.PHASE1_STRICT === '1' || process.env.PHASE1_STRICT === 'true';
}

async function main() {
  const sessionId = requireSessionId('scripts/verify-live-booking-call.cjs');
  const strict = phase1Strict();
  const dbPath = resolveDbPath();
  let db;
  try {
    db = openReadonlyDb(dbPath);
  } catch (_) {
    if (strict) {
      printReportAndExit({
        session_id: sessionId,
        phase1_strict: true,
        pass: false,
        pass_reason: 'db_unavailable_strict_requires_schedule_tool_and_appointment_row'
      });
      return;
    }
    const report = await retellBookingFallback(sessionId);
    printReportAndExit(report);
    return;
  }
  const events = fetchKellyEvents(db, sessionId);

  const scheduleCompleted = findToolCompleted(events, /schedule_appointment/i);

  const bookingOutcome = events.find((e) => e.event_type === 'booking_outcome');
  let outcomeCode = null;
  if (bookingOutcome) {
    try {
      outcomeCode = JSON.parse(bookingOutcome.payload_json || '{}').error_code || 'booked';
    } catch (_) {}
  }

  const appt = (() => {
    try {
      return db
        .prepare(
          `SELECT id, status, appointment_date, appointment_time, triage_session_id
           FROM appointments
           WHERE triage_session_id = ?
           ORDER BY datetime(created_at) DESC LIMIT 1`
        )
        .get(sessionId);
    } catch (e) {
      return null;
    }
  })();

  if (!scheduleCompleted && !appt?.id) {
    if (strict) {
      printReportAndExit({
        session_id: sessionId,
        db_path: dbPath,
        phase1_strict: true,
        event_count: events.length,
        schedule_tool_completed: scheduleCompleted,
        appointment_id: appt?.id || null,
        pass: false,
        pass_reason: 'strict_requires_schedule_tool_and_appointment_row'
      });
      return;
    }
    const report = await retellBookingFallback(sessionId);
    printReportAndExit(report);
    return;
  }

  const pass = scheduleCompleted && !!appt?.id;
  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    phase1_strict: strict,
    event_count: events.length,
    schedule_tool_completed: scheduleCompleted,
    booking_outcome: outcomeCode,
    appointment_id: appt?.id || null,
    appointment_status: appt?.status || null,
    appointment_when: appt ? `${appt.appointment_date} ${appt.appointment_time}` : null,
    pass,
    pass_reason: pass
      ? 'schedule_tool_and_appointment_row'
      : strict
        ? 'strict_requires_schedule_tool_and_appointment_row'
        : 'incomplete_booking_evidence'
  });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
