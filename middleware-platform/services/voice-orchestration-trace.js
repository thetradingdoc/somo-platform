'use strict';

/**
 * Per-turn orchestration trace — mode, lane, tools, TCR hints (not speech metrics).
 */

function emitOrchestrationTrace(db, opts = {}) {
  if (!db?.insertKellyCallEvent) return;
  const sessionId = String(opts.sessionId || opts.session_id || '').trim();
  if (!sessionId) return;
  try {
    db.insertKellyCallEvent({
      session_id: sessionId,
      call_id: opts.callId || opts.call_id || sessionId,
      event_type: 'orchestration_trace',
      payload_json: {
        conversation_mode: opts.conversation_mode || null,
        active_subrail: opts.active_subrail || null,
        handoff: opts.handoff || null,
        lane: opts.lane || opts.active_lane || null,
        step: opts.step || null,
        tools_executed: opts.tools_executed || opts.toolsUsed || [],
        runtime: opts.runtime || 'kelly_rails_v2',
        latency_ms: opts.latency_ms ?? null
      }
    });
  } catch (_) {}
}

module.exports = { emitOrchestrationTrace };
