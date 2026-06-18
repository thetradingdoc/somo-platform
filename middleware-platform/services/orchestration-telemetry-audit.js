'use strict';

/**
 * Telemetry completeness audit for Kelly orchestration paths.
 */

const REQUIRED_TRACE_FIELDS = Object.freeze([
  'conversation_mode',
  'lane',
  'step',
  'gate_matched',
  'gate_outcome',
  'tools_executed'
]);

/**
 * @param {object} payload - orchestration_trace payload_json
 * @returns {{ complete: boolean, missing: string[] }}
 */
function auditOrchestrationTrace(payload = {}) {
  const missing = REQUIRED_TRACE_FIELDS.filter((f) => {
    const val = payload[f];
    if (f === 'tools_executed') return !Array.isArray(val);
    return val == null || val === '';
  });
  return { complete: missing.length === 0, missing };
}

/**
 * Emit a warning event when trace is incomplete (non-blocking).
 */
function emitTelemetryGapIfNeeded(db, sessionId, payload = {}) {
  const { complete, missing } = auditOrchestrationTrace(payload);
  if (complete || !db?.insertKellyCallEvent) return { complete, missing };
  try {
    db.insertKellyCallEvent({
      session_id: sessionId,
      call_id: sessionId,
      event_type: 'orchestration_trace_gap',
      payload_json: { missing, partial: payload }
    });
  } catch (_) {}
  return { complete, missing };
}

module.exports = {
  REQUIRED_TRACE_FIELDS,
  auditOrchestrationTrace,
  emitTelemetryGapIfNeeded
};
