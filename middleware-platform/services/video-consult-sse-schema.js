/**
 * SSE Event Schema - Single source of truth for video consult real-time events.
 * Shared by: Python agents, Node middleware, Provider HUD (video-call.html)
 *
 * Event types:
 *   - connected: Initial handshake when client subscribes
 *   - heartbeat: Keep-alive (every 15-30s)
 *   - assistant_update: Transcript delta, risk, codes, insights, status
 *   - transcript_delta: New transcript lines only
 *   - risk_alert: High-risk symptom detected
 *   - codes_updated: Suggested codes changed
 *   - session_ended: Room session ended
 *   - assistant_message: Kelly PA reply status (thinking | complete)
 *   - tool_event: Tool invocation result (vision capture, derm, pathway)
 */

const EVENT_TYPES = {
  CONNECTED: 'connected',
  HEARTBEAT: 'heartbeat',
  ASSISTANT_UPDATE: 'assistant_update',
  TRANSCRIPT_DELTA: 'transcript_delta',
  RISK_ALERT: 'risk_alert',
  CODES_UPDATED: 'codes_updated',
  SESSION_ENDED: 'session_ended',
  ASSISTANT_MESSAGE: 'assistant_message',
  TOOL_EVENT: 'tool_event'
};

const STATUS_VALUES = {
  LISTENING: 'listening',
  PROCESSING: 'processing',
  CODES_UPDATED: 'codes_updated',
  IDLE: 'idle'
};

const RISK_LEVELS = {
  LOW: 'low',
  MODERATE: 'moderate',
  HIGH: 'high'
};

/**
 * Build assistant_update payload (canonical shape)
 */
function buildAssistantUpdatePayload(options = {}) {
  return {
    transcript_delta: options.transcript_delta || null,
    risk: options.risk || null,
    clinical_insight: options.clinical_insight || null,
    codes: options.codes || null,
    yolo_findings: options.yolo_findings || null,
    status: options.status || STATUS_VALUES.LISTENING
  };
}

/**
 * Build transcript delta item (for linkage)
 */
function buildTranscriptDeltaItem(item) {
  return {
    id: item.id || `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: item.ts || new Date().toISOString(),
    speaker: item.speaker || 'unknown',
    text: item.text || '',
    text_translated: item.text_translated || null
  };
}

/**
 * Build risk payload
 */
function buildRiskPayload(level, flags, options = {}) {
  return {
    level,
    flags: flags || [],
    rule_ids: options.rule_ids || [],
    alert_dedupe_key: options.alert_dedupe_key || null,
    transcript_ids: options.transcript_ids || []
  };
}

function buildAssistantMessagePayload({ text = '', status = 'complete' } = {}) {
  return { text, status, speaker: 'assistant' };
}

function buildToolEventPayload(toolEvent = {}) {
  return {
    name: toolEvent.name,
    args: toolEvent.args || {},
    result: toolEvent.result || {},
    ts: new Date().toISOString()
  };
}

module.exports = {
  EVENT_TYPES,
  STATUS_VALUES,
  RISK_LEVELS,
  buildAssistantUpdatePayload,
  buildTranscriptDeltaItem,
  buildRiskPayload,
  buildAssistantMessagePayload,
  buildToolEventPayload
};
