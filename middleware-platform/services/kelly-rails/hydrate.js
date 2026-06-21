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
    const priorMode = parsed.conversation_mode || null;
    Object.assign(fields, parsed);
    if (!fields.conversation_mode && activeLane) {
      fields.conversation_mode = laneToConversationMode(activeLane);
    } else if (
      priorMode === 'tenant_inbound_admin' &&
      activeLane === 'clinical' &&
      fields.conversation_mode === 'tenant_inbound_clinical'
    ) {
      fields.conversation_mode = 'tenant_inbound_admin';
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
      } else if (
        flags.conversation_mode === 'tenant_inbound_admin' &&
        projection.active_lane === 'clinical'
      ) {
        flags.conversation_mode = 'tenant_inbound_admin';
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

  flags.coding_hitl_resume_pending = metaBool(sessionId, 'coding_hitl_resume_pending');
  flags.coding_hitl_resume_active = metaBool(sessionId, 'coding_hitl_resume_active');
  if (flags.coding_hitl_resume_pending || flags.coding_hitl_resume_active) {
    flags.coding_resume_icd = KellyToolExecutor._getSessionMeta(sessionId, 'coding_hitl_resume_icd') || null;
    flags.coding_resume_cpt = KellyToolExecutor._getSessionMeta(sessionId, 'coding_hitl_resume_cpt') || null;
  }

  if (flags.cancel_complete == null && projection?.flags_json) {
    try {
      const parsed = JSON.parse(projection.flags_json);
      if (parsed.cancel_complete) flags.cancel_complete = true;
      if (parsed.rebook_after_cancel) flags.rebook_after_cancel = true;
      if (parsed.booking_conflict) flags.booking_conflict = true;
      if (parsed.provider_mismatch) flags.provider_mismatch = true;
      if (parsed.provider_preference) flags.provider_preference = parsed.provider_preference;
      if (parsed.reschedule_pending) flags.reschedule_pending = true;
    } catch (_) {}
  }

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

/**
 * Single read path at turn start: projection + meta_kv + triage_sessions row.
 */
function hydrateSessionForTurn(sessionId, { patientId, activeLane } = {}) {
  const sid = String(sessionId || '').trim();
  const projection = sid ? getRailsSessionProjection(sid) : null;
  const lane = activeLane || projection?.active_lane || null;
  const flags = hydrateFlagsFromDb(sid, patientId);
  const conv = hydrateConversationFieldsFromProjection(projection, lane);
  Object.assign(flags, conv);

  const sessionRow = db.getTriageSession ? db.getTriageSession(sid) : null;
  if (sessionRow) {
    flags.triage_complete = !!(
      sessionRow.triage_complete === 1 || sessionRow.triage_complete === true
    );
    flags.has_rag = !!(sessionRow.rag_result_id || flags.has_rag);
    if (sessionRow.target_specialty) flags.target_specialty = sessionRow.target_specialty;
    if (sessionRow.detected_language && !flags.preferred_language) {
      flags.preferred_language = sessionRow.detected_language;
    }
    if (sessionRow.quality || sessionRow.region || sessionRow.onset) {
      flags.opqrst_from_triage = {
        quality: sessionRow.quality || null,
        region: sessionRow.region || sessionRow.body_site || null,
        onset: sessionRow.onset || sessionRow.timing || null,
        severity: sessionRow.severity ?? null
      };
    }
  }

  const preferred = KellyToolExecutor._getSessionMeta(sid, 'kelly_session_locale');
  if (preferred) flags.preferred_language = preferred;

  return {
    flags,
    projection,
    triage: sessionRow,
    active_lane: lane,
    step: projection?.step || null
  };
}

module.exports = {
  hydrateFlagsFromDb,
  hydrateConversationFieldsFromProjection,
  hydrateSessionForTurn,
  metaBool
};
