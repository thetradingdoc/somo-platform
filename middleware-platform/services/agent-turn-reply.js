'use strict';

/**
 * D1 — Envelope for agent turns (routine reasoning today; extend kinds later).
 */

function buildAgentTurnReply(fields = {}) {
  const {
    kind = 'routine_reasoning',
    routine_reply = null,
    validation = null,
    verdict = null,
    chunkBundle = null,
    userMessage = null,
    traceId = null,
    flags = null,
  } = fields;

  return {
    schema_version: '1',
    kind,
    agent_turn_id: traceId || null,
    user_message_echo:
      userMessage != null ? String(userMessage).slice(0, 500) : null,
    routine_reply: validation && validation.valid ? routine_reply : null,
    routine_reply_validation: validation || null,
    verdict_summary: verdict
      ? {
          overall: verdict.overall,
          conflict_count: Array.isArray(verdict.conflicts) ? verdict.conflicts.length : 0,
          reason_code_count: Array.isArray(verdict.reason_codes) ? verdict.reason_codes.length : 0,
        }
      : null,
    chunk_summary: chunkBundle
      ? {
          chunk_count: Array.isArray(chunkBundle.chunks) ? chunkBundle.chunks.length : 0,
          chunk_ids: Array.isArray(chunkBundle.chunk_ids) ? chunkBundle.chunk_ids : [],
        }
      : null,
    flags: flags && typeof flags === 'object' ? flags : null,
  };
}

module.exports = { buildAgentTurnReply };
