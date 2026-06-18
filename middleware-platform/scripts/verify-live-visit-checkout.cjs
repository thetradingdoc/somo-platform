#!/usr/bin/env node
'use strict';

/**
 * Production acceptance — visit checkout row matches visit_pricing.
 *
 * Pass: voice_checkouts row for session AND amount matches visit_pricing.
 *
 * Optional: APPOINTMENT_TYPE=General Consult
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  printReportAndExit
} = require('./verify-live-shared.cjs');

function main() {
  const sessionId = requireSessionId('scripts/verify-live-visit-checkout.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const appointmentType = process.env.APPOINTMENT_TYPE || 'General Consult';

  const checkout = db
    .prepare(
      `SELECT id, amount, clinic_id, appointment_id, triage_session_id, status
       FROM voice_checkouts
       WHERE triage_session_id = ? OR id = ?
       ORDER BY datetime(created_at) DESC LIMIT 1`
    )
    .get(sessionId, sessionId);

  let pricing = null;
  if (checkout?.clinic_id) {
    pricing = db
      .prepare(
        `SELECT base_price, surge_multiplier, appointment_type
         FROM visit_pricing
         WHERE clinic_id = ? AND appointment_type = ?
         LIMIT 1`
      )
      .get(checkout.clinic_id, appointmentType);
  }

  const expectedAmount = pricing
    ? Number((pricing.base_price * (pricing.surge_multiplier || 1)).toFixed(2))
    : null;
  const actualAmount = checkout?.amount != null ? Number(checkout.amount) : null;
  const amountMatches =
    expectedAmount != null && actualAmount != null && Math.abs(expectedAmount - actualAmount) < 0.01;

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    checkout_id: checkout?.id || null,
    checkout_amount: actualAmount,
    visit_pricing_amount: expectedAmount,
    appointment_type: appointmentType,
    amount_matches: amountMatches,
    pass: !!checkout?.id && amountMatches
  });
}

main();
