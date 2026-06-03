'use strict';

const db = require('../database');

const DEFAULT_THRESHOLDS = {
  max_setup_latency_ms: Number(process.env.KELLY_ALERT_MAX_SETUP_LATENCY_MS || 3000),
  max_guardrail_block_rate: Number(process.env.KELLY_ALERT_MAX_GUARDRAIL_BLOCK_RATE || 0.2),
  max_tool_failure_rate: Number(process.env.KELLY_ALERT_MAX_TOOL_FAILURE_RATE || 0.05),
  window_minutes: Number(process.env.KELLY_ALERT_WINDOW_MINUTES || 60)
};

function recordCallStarted({ session_id, call_id, channel, runtime, clinic_id, patient_id, payload = {} } = {}) {
  return db.insertKellyCallEvent?.({
    session_id: session_id || null,
    call_id: call_id || null,
    clinic_id: clinic_id || null,
    event_type: 'call_started',
    payload_json: {
      channel: channel || 'unknown',
      runtime: runtime || 'kelly_rails_v2',
      clinic_id: clinic_id || null,
      patient_id: patient_id || null,
      ...payload
    }
  });
}

function recordCallCompleted({
  session_id,
  call_id,
  channel,
  runtime,
  final_lane,
  final_step,
  disposition,
  guardrail_count = 0,
  tool_failure_count = 0,
  turn_count = 0,
  extra = {}
} = {}) {
  return db.insertKellyCallEvent?.({
    session_id: session_id || null,
    call_id: call_id || null,
    event_type: 'call_completed',
    payload_json: {
      channel: channel || 'unknown',
      runtime: runtime || 'kelly_rails_v2',
      final_lane: final_lane || null,
      final_step: final_step || null,
      disposition: disposition || 'unknown',
      guardrail_count,
      tool_failure_count,
      turn_count,
      ...extra
    }
  });
}

function summarizeSessionEvents(sessionId) {
  const rows = db.listKellyCallEvents?.({ session_id: sessionId, limit: 200 }) || [];
  const turns = rows.filter((r) => r.event_type === 'turn_resolved');
  const blocks = rows.filter((r) => r.event_type === 'guardrail_blocked' || r.event_type === 'runtime_blocked');
  const started = rows.find((r) => r.event_type === 'call_started');
  const completed = rows.find((r) => r.event_type === 'call_completed');
  const lastTurn = turns[0];
  let lastPayload = {};
  try {
    lastPayload = lastTurn?.payload_json ? JSON.parse(lastTurn.payload_json) : {};
  } catch (_) {}

  const legacyRuntimes = turns.filter((r) => {
    try {
      const p = JSON.parse(r.payload_json || '{}');
      return p.runtime && p.runtime !== 'kelly_rails_v2';
    } catch (_) {
      return false;
    }
  });

  return {
    session_id: sessionId,
    event_count: rows.length,
    turn_count: turns.length,
    guardrail_block_count: blocks.length,
    legacy_runtime_turns: legacyRuntimes.length,
    started_at: started?.created_at || null,
    completed_at: completed?.created_at || null,
    disposition: completed?.payload_json
      ? (() => {
          try {
            return JSON.parse(completed.payload_json).disposition;
          } catch (_) {
            return null;
          }
        })()
      : null,
    final_lane: lastPayload.lane || completed?.payload_json
      ? (() => {
          try {
            return JSON.parse(completed.payload_json).final_lane;
          } catch (_) {
            return null;
          }
        })()
      : lastPayload.lane,
    final_step: lastPayload.step || null,
    events: rows
  };
}

function checkAlertThresholds(windowMinutes = DEFAULT_THRESHOLDS.window_minutes) {
  const rows = db.listKellyCallEvents?.({ limit: 500 }) || [];
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  const turns = recent.filter((r) => r.event_type === 'turn_resolved');
  const blocks = recent.filter(
    (r) => r.event_type === 'guardrail_blocked' || r.event_type === 'runtime_blocked'
  );
  const legacy = turns.filter((r) => {
    try {
      const p = JSON.parse(r.payload_json || '{}');
      return p.runtime && p.runtime !== 'kelly_rails_v2';
    } catch (_) {
      return false;
    }
  });
  const blockRate = turns.length ? blocks.length / turns.length : 0;
  const alerts = [];
  if (blockRate > DEFAULT_THRESHOLDS.max_guardrail_block_rate) {
    alerts.push({ code: 'GUARDRAIL_BLOCK_RATE', value: blockRate, threshold: DEFAULT_THRESHOLDS.max_guardrail_block_rate });
  }
  if (legacy.length > 0 && process.env.NODE_ENV === 'production') {
    alerts.push({ code: 'LEGACY_RUNTIME_DETECTED', count: legacy.length });
  }
  return { ok: alerts.length === 0, alerts, window_minutes: windowMinutes, thresholds: DEFAULT_THRESHOLDS };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  recordCallStarted,
  recordCallCompleted,
  summarizeSessionEvents,
  checkAlertThresholds
};
