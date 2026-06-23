'use strict';

/**
 * D2 — After evaluate_skincare_routine succeeds, persist a compact snapshot for
 * UI / session merge (reasoning_map, client hydration). Does not call the LLM.
 */

const KellyToolExecutor = require('../kelly/kelly-tool-executor');

function persistRoutinePostHookSnapshot(sessionId, toolResult, context = {}) {
  if (process.env.KELLY_ROUTINE_POST_HOOK === '0') return;
  if (!sessionId || !toolResult || !toolResult.success) return;
  try {
    const snap = {
      ts: new Date().toISOString(),
      verdict_overall: toolResult.verdict?.overall ?? null,
      conflict_count: toolResult.verdict?.conflicts?.length ?? 0,
      agent_turn: toolResult.agent_turn || null,
      routine_reply_valid: toolResult.routine_reply_validation?.valid ?? null,
      has_system_prompt: Boolean(toolResult.system_prompt),
      user_message_len: String(context.userMessage || '').length,
      compose_source: context.compose_source || null,
    };
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_routine_post_hook_json', JSON.stringify(snap));
  } catch (_) {}
}

function getRoutinePostHookSnapshot(sessionId) {
  if (!sessionId) return null;
  try {
    const raw = KellyToolExecutor._getSessionMeta(String(sessionId), 'kelly_routine_post_hook_json');
    if (!raw || typeof raw !== 'string') return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = {
  persistRoutinePostHookSnapshot,
  getRoutinePostHookSnapshot,
};
