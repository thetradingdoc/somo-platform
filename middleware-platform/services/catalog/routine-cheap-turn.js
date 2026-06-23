'use strict';

/**
 * D3 — Routine pathway only: skip LLM for pure greetings/smalltalk when routine has no products yet.
 */

const {
  buildRoutineReasoningPayload,
  isEmptyRoutineSlots,
  isGreetingOrSmalltalkMessage,
} = require('./routine-reasoning-orchestrator');
const { createSessionStateService } = require('../shared/session-state');

/**
 * @returns {{ reply: string } | null}
 */
function tryRoutinePhaseCheapTurn({ db, sessionId, message }) {
  if (!db || sessionId == null) return null;
  const msg = String(message || '').trim();
  if (!isGreetingOrSmalltalkMessage(msg)) return null;
  try {
    const sessions = createSessionStateService(db);
    const pack = sessions.getRoutineForEvaluation(String(sessionId));
    const slots = pack && Array.isArray(pack.slots) ? pack.slots : [];
    if (!isEmptyRoutineSlots(slots)) return null;
    const payload = buildRoutineReasoningPayload({
      db,
      sessionId: String(sessionId),
      slots,
      userMessage: msg,
    });
    if (payload.short_circuit !== 'greeting_no_routine') return null;
    const reply =
      payload.routine_reply && typeof payload.routine_reply.narrative === 'string'
        ? payload.routine_reply.narrative.trim()
        : 'Hi! When you add your AM and PM products, I can check ingredient interactions for you.';
    return { reply };
  } catch (_) {
    return null;
  }
}

module.exports = { tryRoutinePhaseCheapTurn };
