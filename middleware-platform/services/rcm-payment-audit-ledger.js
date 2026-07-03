'use strict';

/**
 * Money audit ledger — unified trace from voice session → 271 → quote → payment intent → settlement.
 *
 * Schema stub: migration 106_rcm_payment_audit_ledger.js
 *   rcm_payment_audit_ledger (
 *     id, clinic_id, session_id, call_id,
 *     stage,            -- eligibility|quote|payment_intent|settlement|refund
 *     external_ref_type, external_ref_id,
 *     amount_cents, currency,
 *     status,           -- pending|posted|failed|reversed
 *     details_json, created_at
 *   )
 *
 * Writers (future): resolve-amount-due, rcm-payment-request-service, rcm-payment-settlement.
 * Readers (future): admin wallboard, amount-resolution mismatch tooling.
 */

function recordAuditEvent(_db, _entry) {
  return { success: false, error: 'not_implemented' };
}

function listAuditEventsForSession(_db, _sessionId) {
  return [];
}

module.exports = {
  recordAuditEvent,
  listAuditEventsForSession
};
