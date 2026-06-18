#!/usr/bin/env node
'use strict';

/**
 * Production acceptance — live copay / payment-link call.
 *
 * Pass: tool_completed request_patient_payment AND payment_link_sent event.
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  fetchKellyEvents,
  findToolCompleted,
  findEventType,
  printReportAndExit
} = require('./verify-live-shared.cjs');

function main() {
  const sessionId = requireSessionId('scripts/verify-live-copay-call.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  const paymentTool = findToolCompleted(events, /request_patient_payment/i);
  const linkSent = findEventType(events, 'payment_link_sent');

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    event_count: events.length,
    request_patient_payment_completed: paymentTool,
    payment_link_sent: linkSent,
    pass: paymentTool && linkSent
  });
}

main();
