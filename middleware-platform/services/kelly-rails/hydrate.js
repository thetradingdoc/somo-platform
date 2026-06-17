'use strict';

const db = require('../../database');
const KellyToolExecutor = require('../kelly-tool-executor');
const { defaultFlags, defaultConversationFields, laneToConversationMode } = require('./state-schema');
const { getRailsSessionProjection } = require('./session-ssot');

function metaBool(sessionId, key) {
  const v = String(KellyToolExecutor._getSessionMeta(sessionId, key) || '').toLowerCase();
  return v === '1' || v === 'true';
}

function hydrateConversationFieldsFromProjection(projection, activeLane) {
  const fields = defaultConversationFields();
  if (!projection?.flags_json) {
    if (activeLane) fields.conversation_mode = laneToConversationMode(activeLane);
    return fields;
  }
  try {
    const parsed = JSON.parse(projection.flags_json);
    Object.assign(fields, parsed);
    if (!fields.conversation_mode && activeLane) {
      fields.conversation_mode = laneToConversationMode(activeLane);
    }
    if (!fields.opqrst_accumulator || typeof fields.opqrst_accumulator !== 'object') {
      fields.opqrst_accumulator = defaultConversationFields().opqrst_accumulator;
    }
    if (!Array.isArray(fields.pending_intent_queue)) fields.pending_intent_queue = [];
    if (!Array.isArray(fields.completed_intents)) fields.completed_intents = [];
    return fields;
  } catch (_) {
    if (activeLane) fields.conversation_mode = laneToConversationMode(activeLane);
    return fields;
  }
}

function hydrateFlagsFromDb(sessionId, patientId) {
  const convFields = defaultConversationFields();
  const flags = { ...convFields, ...defaultFlags() };
  const projection = getRailsSessionProjection(sessionId);
  if (projection?.flags_json) {
    try {
      const parsed = JSON.parse(projection.flags_json);
      Object.assign(flags, parsed);
      if (parsed.triage_complete) flags.triage_complete = true;
      if (parsed.has_rag) flags.has_rag = true;
      if (parsed.safety_blocked) flags.safety_blocked = true;
      if (parsed.payment_complete) flags.payment_complete = true;
      if (parsed.routine_intake_active) flags.routine_intake_active = true;
      if (parsed.appointment_id) flags.appointment_id = parsed.appointment_id;
      if (!flags.conversation_mode && projection.active_lane) {
        flags.conversation_mode = laneToConversationMode(projection.active_lane);
      }
    } catch (_) {}
  }

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
  flags.safety_blocked = metaBool(sessionId, 'safety_blocked');
  flags.post_visit_confirmation_pending = metaBool(sessionId, 'post_visit_confirmation_pending');
  flags.payment_complete = metaBool(sessionId, 'payment_complete');

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

module.exports = { hydrateFlagsFromDb, hydrateConversationFieldsFromProjection, metaBool };
