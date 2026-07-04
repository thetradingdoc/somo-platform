'use strict';

/**
 * SQL scope for voice calls belonging to a customer tenant.
 * @param {string} customerId
 * @returns {{ clause: string, params: string[] }}
 */
function voiceCallScopeClause(customerId) {
  return {
    clause:
      '(customer_id = ? OR (clinic_id IS NOT NULL AND clinic_id IN ' +
      '(SELECT clinic_id FROM customer_clinics WHERE customer_id = ?)))',
    params: [customerId, customerId]
  };
}

/**
 * Verify a session/call id belongs to the authenticated customer.
 * @param {object} db
 * @param {string} customerId
 * @param {string} sessionId
 * @returns {boolean}
 */
function customerOwnsCallSession(db, customerId, sessionId) {
  if (!db?.db || !customerId || !sessionId) return false;
  const scope = voiceCallScopeClause(customerId);
  const voiceRow = db.db
    .prepare(`SELECT 1 AS ok FROM voice_call_log WHERE call_id = ? AND ${scope.clause} LIMIT 1`)
    .get(sessionId, ...scope.params);
  if (voiceRow?.ok) return true;
  const eventRow = db.db
    .prepare(`SELECT 1 AS ok FROM kelly_call_events WHERE session_id = ? AND customer_id = ? LIMIT 1`)
    .get(sessionId, customerId);
  return !!eventRow?.ok;
}

module.exports = { voiceCallScopeClause, customerOwnsCallSession };
