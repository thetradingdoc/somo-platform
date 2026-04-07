const { buildEventEnvelope } = require('./event-envelope');
const { normalizeIntakeEvent } = require('./intake-normalizer');
const SessionStateStore = require('./session-state-store');
const Metrics = require('./metrics');
const db = require('../database');

function _normalizePayload(payload) {
  if (payload == null) return {};
  if (typeof payload === 'object') return payload;
  return { value: payload };
}

function adaptIncomingEvent({
  source,
  eventType,
  payload,
  sessionId,
  roomId,
  requestId,
  metadata
} = {}) {
  try {
    const normalizedPayload = _normalizePayload(payload);
    const envelope = buildEventEnvelope({
      source,
      eventType,
      payload: normalizedPayload,
      sessionId,
      roomId,
      requestId,
      metadata
    });

    const normalized_event = normalizeIntakeEvent(envelope);
    Metrics.increment('channel_adapter.events_total', 1);
    Metrics.increment(`channel_adapter.event_type.${envelope.event_type}`, 1);
    Metrics.increment(`intake_normalizer.normalized_type.${normalized_event.normalized_type}`, 1);

    if (db?.insertIntakeStreamEvent) {
      db.insertIntakeStreamEvent({
        event_id: envelope.event_id,
        trace_id: envelope.trace_id,
        request_id: envelope.request_id || null,
        source: envelope.source,
        event_type: envelope.event_type,
        session_id: envelope.session_id || null,
        room_id: envelope.room_id || null,
        raw_envelope: envelope,
        normalized_event
      });
    }
    SessionStateStore.upsertFromNormalizedEvent({
      envelope,
      normalizedEvent: normalized_event
    });

    return {
      envelope,
      adapted_event: {
        id: envelope.event_id,
        trace_id: envelope.trace_id,
        ts: envelope.timestamp,
        source: envelope.source,
        event_type: envelope.event_type,
        session_id: envelope.session_id || null,
        room_id: envelope.room_id || null,
        payload: envelope.payload
      },
      normalized_event
    };
  } catch (e) {
    Metrics.increment('channel_adapter.rejected_total', 1);
    Metrics.increment('intake_normalizer.errors_total', 1);
    return {
      envelope: null,
      adapted_event: null,
      normalized_event: null,
      error: e.message || 'adapter_failed'
    };
  }
}

module.exports = {
  adaptIncomingEvent
};
