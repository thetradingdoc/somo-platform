'use strict';

const db = require('../../database');
const KellyToolExecutor = require('../kelly-tool-executor');
const { defaultFlags } = require('./state-schema');

function metaBool(sessionId, key) {
  const v = String(KellyToolExecutor._getSessionMeta(sessionId, key) || '').toLowerCase();
  return v === '1' || v === 'true';
}

function hydrateFlagsFromDb(sessionId, patientId) {
  const flags = defaultFlags();
  const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;

  flags.routine_intake_active = metaBool(sessionId, 'routine_intake_active');
  flags.triage_complete = !!(
    sessionRow &&
    (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true)
  );
  flags.has_rag = !!(sessionRow && sessionRow.rag_result_id);
  flags.booking_intent_seen = metaBool(sessionId, 'booking_intent_seen');
  flags.basic_intake_complete = metaBool(sessionId, 'basic_intake_complete');
  flags.pending_human_handoff = metaBool(sessionId, 'pending_human_handoff');

  const appt = KellyToolExecutor._getSessionMeta(sessionId, 'last_appointment_id');
  if (appt) flags.appointment_id = appt;

  const copay = KellyToolExecutor._getSessionMeta(sessionId, 'copay_amount');
  if (copay) flags.copay_amount = parseFloat(copay);

  const payTok = KellyToolExecutor._getSessionMeta(sessionId, 'rcm_pay_token');
  if (payTok) flags.payment_token = payTok;

  if (patientId && db.db) {
    try {
      const elig = db.db
        .prepare(
          `SELECT copay_amount FROM eligibility_checks WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(patientId);
      if (elig?.copay_amount != null && flags.copay_amount == null) {
        flags.copay_amount = elig.copay_amount;
      }
    } catch (_) {}
  }

  return flags;
}

module.exports = { hydrateFlagsFromDb, metaBool };
