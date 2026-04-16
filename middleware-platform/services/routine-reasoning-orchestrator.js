'use strict';

const { createConflictGraph } = require('./ingredient-conflict-graph');
const { createSessionStateService } = require('./session-state');
const { createRetriever } = require('./retriever');
const {
  composeLocal,
  buildSystemPrompt,
  buildUserPrompt,
  validateReply,
  logRoutineReplyRejected,
  collectRoutineProductIds,
} = require('./composer');
const { buildAgentTurnReply } = require('./agent-turn-reply');

/** D3 — skip full graph + RAG when there is nothing to analyze and the user is just greeting. */
function isEmptyRoutineSlots(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return true;
  for (const s of slots) {
    if (Array.isArray(s.ingredient_ids) && s.ingredient_ids.length) return false;
    if (Array.isArray(s.steps)) {
      for (const st of s.steps) {
        if (Array.isArray(st.ingredient_ids) && st.ingredient_ids.length) return false;
      }
    }
  }
  return true;
}

function isGreetingOrSmalltalkMessage(msg) {
  const t = String(msg || '').trim().toLowerCase();
  if (!t.length || t.length > 140) return false;
  return (
    /^(hi|hello|hey|hiya|yo|sup|howdy)\b/.test(t) ||
    /^good\s+(morning|afternoon|evening|night)\b/.test(t) ||
    /^(thanks?|thank\s+you|thx|ty)\b/.test(t) ||
    /^(ok+|okay|k)\.?$/i.test(t) ||
    /^(bye|goodbye|see\s+you|cya)\b/.test(t) ||
    /^what'?s\s+up\b/.test(t) ||
    /^how\s+are\s+you\b/.test(t) ||
    /^nice\s+to\s+meet\b/.test(t)
  );
}

function _shadowLogRoutinePayload(payload, sessionId) {
  if (process.env.ROUTINE_REASONING_SHADOW !== '1') return;
  try {
    console.warn(
      '[ROUTINE_REASONING_SHADOW]',
      JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: sessionId || null,
        overall: payload.verdict?.overall,
        short_circuit: payload.short_circuit || null,
        chunk_count: payload.chunkBundle?.chunks?.length ?? 0,
        agent_turn_kind: payload.agentTurn?.kind || null,
      })
    );
  } catch (_) {}
}

/** D5 — Structured shadow metrics (latency + counts) for rollout dashboards. */
function _shadowMetricsLine(payload, sessionId, ms) {
  if (process.env.ROUTINE_REASONING_SHADOW_METRICS !== '1') return;
  try {
    const Metrics = require('./metrics');
    Metrics.increment('routine_reasoning.shadow.run.count', 1);
    Metrics.increment('routine_reasoning.shadow.latency_ms.total', Math.round(ms));
    Metrics.increment('routine_reasoning.shadow.chunk_count.total', payload.chunkBundle?.chunks?.length ?? 0);
  } catch (_) {}
  try {
    console.warn(
      '[ROUTINE_REASONING_SHADOW_METRICS]',
      JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: sessionId || null,
        ms: Math.round(ms * 100) / 100,
        overall: payload.verdict?.overall ?? null,
        short_circuit: payload.short_circuit || null,
        chunk_count: payload.chunkBundle?.chunks?.length ?? 0,
        validation_valid: payload.validation?.valid ?? null,
      })
    );
  } catch (_) {}
}

/** D5 — Compare unified bundle size vs legacy ingredient_rag_chunks-only merge (same DB). */
function _shadowLogLegacyBundleDiff(db, verdict, unifiedChunkCount, sessionId) {
  if (process.env.ROUTINE_REASONING_SHADOW !== '1') return;
  if (process.env.ROUTINE_REASONING_SHADOW_LEGACY_DIFF !== '1') return;
  if (!db || !verdict) return;
  try {
    const { getChunksForRoutineVerdict } = require('./ingredient-rag-chunks-service');
    const legacy = getChunksForRoutineVerdict(verdict, db);
    console.warn(
      '[ROUTINE_REASONING_SHADOW_LEGACY_DIFF]',
      JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: sessionId || null,
        unified_chunk_count: unifiedChunkCount,
        legacy_ingredient_rag_chunk_count: legacy.length,
        overall: verdict.overall,
      })
    );
  } catch (_) {}
}

function buildGreetingNoRoutineReply(session) {
  const routine_reply = {
    overall: 'safe',
    conflicts: [],
    suggested_split: null,
    safe_to_combine: [],
    narrative:
      'Hi! I have not seen any products in your routine yet. Add your AM/PM steps and I can check ingredient interactions for you.',
    cited_chunk_ids: [],
    reason_codes: [],
    sensitive_note:
      session.sensitivity === 'moderate' || session.sensitivity === 'severe'
        ? `Note: your profile lists skin sensitivity as "${session.sensitivity}" — patch-test new products when you add them.`
        : null,
    contraindication_warnings: [],
  };
  return routine_reply;
}

/**
 * End-to-end: graph verdict → knowledge_chunks retrieval → local compose (or LLM elsewhere).
 *
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} [opts.sessionId] - Kelly session / user id for user_sessions
 * @param {Array<{time:string, ingredient_ids:string[]}>} [opts.slots] - if empty and sessionId set, uses toRoutineSlots
 * @param {string} [opts.userMessage]
 * @param {string[]} [opts.productIds] — merged with session routine product_ids for B3/B4 slice
 * @param {string[]} [opts.skus] — optional explicit SKUs (union with catalog lookup by product id)
 */
function buildRoutineReasoningPayload(opts = {}) {
  const tMs = Date.now();
  const { db, sessionId, slots: slotsIn, userMessage = '', productIds, skus } = opts;
  const graph = createConflictGraph(db);
  const sessions = createSessionStateService(db);
  let slots = Array.isArray(slotsIn) ? slotsIn : [];
  const sid = sessionId != null ? String(sessionId) : '';
  if (!slots.length && sid) {
    const pack = sessions.getRoutineForEvaluation(sid);
    slots = pack && Array.isArray(pack.slots) ? pack.slots : [];
  }

  const session = sid ? sessions.get(sid) : sessions.get('kelly');
  const msg = String(userMessage || '');

  if (isEmptyRoutineSlots(slots) && isGreetingOrSmalltalkMessage(msg)) {
    const verdict = {
      overall: 'safe',
      conflicts: [],
      reason_codes: [],
      safe_ids: [],
      suggested_split: null,
    };
    const chunkBundle = { chunks: [], chunk_ids: [], coverage: [] };
    const routine_reply = buildGreetingNoRoutineReply(session);
    const citationCtxGreet = { chunkBundle, verdict, session };
    const validation = validateReply(routine_reply, citationCtxGreet);
    if (!validation.valid) {
      logRoutineReplyRejected({
        source: 'greeting_no_routine',
        errors: validation.errors,
        reply: routine_reply,
        context: { stage: 'composeLocal', sessionId: sid || null },
      });
    }
    const agentTurn = buildAgentTurnReply({
      routine_reply,
      validation,
      verdict,
      chunkBundle,
      userMessage: msg,
      flags: { short_circuit: 'greeting_no_routine' },
    });
    const out = {
      verdict,
      chunkBundle,
      session,
      routine_reply,
      validation,
      system_prompt: null,
      user_prompt: msg ? buildUserPrompt(msg, session, sid ? sessions.getContextBundle(sid) : null) : null,
      slots,
      agentTurn,
      short_circuit: 'greeting_no_routine',
    };
    _shadowLogRoutinePayload(out, sid);
    _shadowLogLegacyBundleDiff(db, verdict, out.chunkBundle?.chunks?.length ?? 0, sid);
    _shadowMetricsLine(out, sid, Date.now() - tMs);
    return out;
  }

  const verdict = graph.evaluateRoutine(slots);
  const retriever = createRetriever(db);
  const explicitPids = Array.isArray(productIds)
    ? productIds.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const sessionPids = collectRoutineProductIds(session);
  const mergedProductIds = [...new Set([...explicitPids, ...sessionPids])];
  const retrieverOpts = {};
  if (mergedProductIds.length) retrieverOpts.productIds = mergedProductIds;
  if (Array.isArray(skus) && skus.length) {
    retrieverOpts.skus = skus.map((x) => String(x || '').trim()).filter(Boolean);
  }
  const chunkBundle = retriever.getChunksForVerdict(
    verdict,
    Object.keys(retrieverOpts).length ? retrieverOpts : {}
  );
  const routine_reply = composeLocal(verdict, chunkBundle, session);
  const citationCtx = { chunkBundle, verdict, session };
  const validation = validateReply(routine_reply, citationCtx);
  if (!validation.valid) {
    logRoutineReplyRejected({
      source: 'orchestrator_compose_local',
      errors: validation.errors,
      reply: routine_reply,
      context: { stage: 'composeLocal', sessionId: sid || null },
    });
  }
  const system_prompt = buildSystemPrompt(verdict, chunkBundle, session);
  const user_prompt = msg
    ? buildUserPrompt(msg, session, sid ? sessions.getContextBundle(sid) : null)
    : null;
  const agentTurn = buildAgentTurnReply({
    routine_reply,
    validation,
    verdict,
    chunkBundle,
    userMessage: msg,
  });
  const out = {
    verdict,
    chunkBundle,
    session,
    routine_reply,
    validation,
    system_prompt,
    user_prompt,
    slots,
    agentTurn,
    short_circuit: null,
  };
  _shadowLogRoutinePayload(out, sid);
  _shadowLogLegacyBundleDiff(db, verdict, out.chunkBundle?.chunks?.length ?? 0, sid);
  _shadowMetricsLine(out, sid, Date.now() - tMs);
  return out;
}

module.exports = {
  buildRoutineReasoningPayload,
  isEmptyRoutineSlots,
  isGreetingOrSmalltalkMessage,
};
