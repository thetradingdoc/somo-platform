'use strict';

/**
 * Kelly Phase C — structured language mismatch telemetry.
 */

function emitLanguageMismatch(db, payload = {}) {
  if (!db?.insertKellyCallEvent) return null;
  const body = {
    detected_language: payload.detected_language ?? null,
    session_language: payload.session_language ?? null,
    asr_language: payload.asr_language ?? null,
    asr_confidence: payload.asr_confidence ?? null,
    mismatch_type: payload.mismatch_type || 'unknown',
    action_taken: payload.action_taken || 'continue',
    channel: payload.channel || null,
    runtime: payload.runtime || 'kelly_rails_v2',
    ...payload.extra
  };
  return db.insertKellyCallEvent({
    session_id: payload.session_id || null,
    call_id: payload.call_id || null,
    event_type: 'language_mismatch',
    payload_json: body
  });
}

module.exports = { emitLanguageMismatch };
