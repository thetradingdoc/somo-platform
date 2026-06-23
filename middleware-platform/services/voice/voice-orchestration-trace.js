'use strict';

/**
 * Per-turn orchestration trace — mode, lane, step, gate, tools, TCR hints.
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
        routing_world: opts.routing_world || null,
        conversation_mode: opts.conversation_mode || null,
        active_subrail: opts.active_subrail || null,
        handoff: opts.handoff || null,
        lane: opts.lane || opts.active_lane || null,
        step: opts.step || null,
        gate_matched: opts.gate_matched || null,
        gate_outcome: opts.gate_outcome || null,
        tools_executed: opts.tools_executed || opts.toolsUsed || [],
        runtime: opts.runtime || 'kelly_rails_v2',
        latency_ms: opts.latency_ms ?? null
      }
    });
  } catch (_) {}
}

module.exports = { emitOrchestrationTrace };
