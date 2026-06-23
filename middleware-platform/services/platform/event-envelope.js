const { v4: uuidv4 } = require('uuid');

function _cleanString(value) {
  const s = String(value || '').trim();
  return s || null;
}

function buildEventEnvelope({
  source,
  eventType,
  payload,
  sessionId,
  roomId,
  requestId,
  metadata
} = {}) {
  const computedTraceId = _cleanString(requestId) || `trace-${uuidv4()}`;
  const envelope = {
    event_id: `evt-${uuidv4()}`,
    timestamp: new Date().toISOString(),
    trace_id: computedTraceId,
    source: _cleanString(source) || 'unknown',
    event_type: _cleanString(eventType) || 'unknown',
    payload: payload == null ? {} : payload
  };

  const sid = _cleanString(sessionId);
  if (sid) envelope.session_id = sid;

  const rid = _cleanString(roomId);
  if (rid) envelope.room_id = rid;

  const reqId = _cleanString(requestId);
  if (reqId) envelope.request_id = reqId;

  if (metadata && typeof metadata === 'object') {
    envelope.metadata = metadata;
  }

  return envelope;
}

module.exports = {
  buildEventEnvelope
};
