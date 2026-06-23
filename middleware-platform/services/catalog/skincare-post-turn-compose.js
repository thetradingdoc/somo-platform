'use strict';

/**
 * D2 — Run deterministic routine reasoning composer after every routine-phase turn
 * (not only when evaluate_skincare_routine tool ran). Persists compact snapshot for UI.
 */

function runDefaultSkincarePostTurnCompose({ db, sessionId, userMessage }) {
  if (process.env.KELLY_SKINCARE_POST_TURN_COMPOSE !== '1') return null;
  if (!db || !sessionId) return null;
  try {
    const KellyToolExecutor = require('../kelly/kelly-tool-executor');
    const { buildRoutineReasoningPayload } = require('./routine-reasoning-orchestrator');
    const payload = buildRoutineReasoningPayload({
      db,
      sessionId: String(sessionId),
      slots: [],
      userMessage: String(userMessage || ''),
    });
    const sidecar = {
      verdict: payload.verdict,
      routine_reply: payload.routine_reply,
      validation: payload.validation,
      agentTurn: payload.agentTurn,
      chunk_count: payload.chunkBundle?.chunks?.length ?? 0,
      short_circuit: payload.short_circuit,
      system_prompt: payload.system_prompt,
      user_prompt: payload.user_prompt,
    };
    try {
      KellyToolExecutor._setSessionMeta(
        String(sessionId),
        'kelly_skincare_compose_json',
        JSON.stringify({
          ts: new Date().toISOString(),
          overall: payload.verdict?.overall,
          validation_valid: payload.validation?.valid,
          chunk_count: sidecar.chunk_count,
          short_circuit: payload.short_circuit,
          verdict: payload.verdict,
          agent_turn: payload.agentTurn,
          routine_reply: payload.routine_reply,
          routine_reply_validation: payload.validation,
          has_system_prompt: Boolean(payload.system_prompt),
          compose_source: 'default_post_turn',
        })
      );
    } catch (_) {}
    return sidecar;
  } catch (_) {
    return null;
  }
}

module.exports = { runDefaultSkincarePostTurnCompose };
