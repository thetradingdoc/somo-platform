const db = require('../../database');
const Metrics = require('./metrics');
const IntakeRequiredFields = require('./intake-required-fields');
const { extractTenantWriteContext } = require('../platform/tenant-write-context');

function _asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function _uniq(list) {
  return [...new Set(_asArray(list).map((x) => String(x || '').trim()).filter(Boolean))];
}

function _stateId(sessionId, roomId) {
  if (sessionId) return `session:${sessionId}`;
  if (roomId) return `room:${roomId}`;
  return null;
}

function upsertFromNormalizedEvent({ envelope, normalizedEvent }) {
  const sessionId = normalizedEvent?.session_id || envelope?.session_id || null;
  const roomId = normalizedEvent?.room_id || envelope?.room_id || null;
  const id = _stateId(sessionId, roomId);
  if (!id) {
    Metrics.increment('session_state.projection_skipped_missing_key', 1);
    return { success: false, error: 'missing_session_or_room' };
  }

  const current = db.getSessionStateProjection ? db.getSessionStateProjection({ session_id: sessionId, room_id: roomId }) : null;
  const fields = normalizedEvent?.fields || {};
  const tenant = extractTenantWriteContext({
    clinic_id: normalizedEvent?.clinic_id || envelope?.clinic_id,
    customer_id: normalizedEvent?.customer_id || envelope?.customer_id,
    session_id: sessionId
  });
  const next = {
    id,
    session_id: sessionId,
    room_id: roomId,
    trace_id: envelope?.trace_id || current?.trace_id || null,
    source_last: normalizedEvent?.source || envelope?.source || current?.source_last || null,
    event_type_last: normalizedEvent?.event_type || envelope?.event_type || current?.event_type_last || null,
    last_event_id: envelope?.event_id || current?.last_event_id || null,
    chief_complaint: fields?.chief_complaint || current?.chief_complaint || null,
    body_sites: _uniq([...(current?.body_sites || []), ...(fields?.body_sites || [])]),
    severity: fields?.severity != null ? fields.severity : (current?.severity ?? null),
    timeline: fields?.timeline || current?.timeline || null,
    risk_flags: _uniq([...(current?.risk_flags || []), ...(fields?.risk_flags || [])]),
    raw_last_text: normalizedEvent?.text || current?.raw_last_text || null,
    clinic_id: tenant.clinicId || current?.clinic_id || null,
    customer_id: tenant.customerId || current?.customer_id || null
  };

  const write = db.upsertSessionStateProjection ? db.upsertSessionStateProjection(next) : { success: false, error: 'db_method_missing' };
  if (write?.success) {
    Metrics.increment('session_state.projection_upserts_total', 1);
  } else {
    Metrics.increment('session_state.projection_upsert_fail_total', 1);
  }
  return write;
}

function getCanonicalState({ sessionId = null, roomId = null } = {}) {
  if (!db.getSessionStateProjection) return null;
  return db.getSessionStateProjection({ session_id: sessionId, room_id: roomId });
}

function evaluateGate({ pathway = 'triage', sessionId = null, roomId = null } = {}) {
  const state = getCanonicalState({ sessionId, roomId }) || {};
  const gate = IntakeRequiredFields.evaluateRequiredFields(pathway, state);
  return {
    ...gate,
    state
  };
}

module.exports = {
  upsertFromNormalizedEvent,
  getCanonicalState,
  evaluateGate
};
