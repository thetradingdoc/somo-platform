'use strict';

/**
 * Shared HITL resume hints for Kelly rails + voice turns.
 * Pending meta is cleared only after collect_insurance succeeds.
 */

const KellyToolExecutor = require('./kelly-tool-executor');
const { KELLY_LANE } = require('./kelly-rails/state-schema');

function isResumePending(sessionId) {
  if (!sessionId) return false;
  const pending = String(KellyToolExecutor._getSessionMeta(sessionId, 'coding_hitl_resume_pending') || '').toLowerCase();
  return pending === '1' || pending === 'true';
}

function isResumeActive(sessionId) {
  if (!sessionId) return false;
  if (isResumePending(sessionId)) return true;
  const active = String(KellyToolExecutor._getSessionMeta(sessionId, 'coding_hitl_resume_active') || '').toLowerCase();
  return active === '1' || active === 'true';
}

function applyCodingHitlResumeToTurn(state, ctx) {
  if (!ctx?.sessionId || !isResumePending(ctx.sessionId)) return false;

  const icd = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'coding_hitl_resume_icd') || '';
  const cpt = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'coding_hitl_resume_cpt') || '';

  try {
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'coding_hitl_resume_active', '1');
  } catch (_) {}

  state.flags.coding_hitl_resume_active = true;
  state.flags.coding_hitl_resumed = true;
  state.flags.coding_resume_icd = icd;
  state.flags.coding_resume_cpt = cpt;
  state.active_lane = KELLY_LANE.PAYMENT;
  state.step = 'insurance';

  const hint =
    `Clinical coding review approved (${icd} + ${cpt}). ` +
    'Continue: call collect_insurance with the patient payer/plan, then compute_visit_quote if needed, then schedule_appointment.';
  ctx.providerInstructions = ctx.providerInstructions
    ? `${ctx.providerInstructions}\n${hint}`
    : hint;
  return true;
}

function clearCodingHitlResumePending(sessionId) {
  if (!sessionId) return;
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_pending', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_active', '0');
  } catch (_) {}
}

function clearCodingHitlResumeMeta(sessionId) {
  if (!sessionId) return;
  clearCodingHitlResumePending(sessionId);
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_icd', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_cpt', '');
  } catch (_) {}
}

module.exports = {
  isResumePending,
  isResumeActive,
  applyCodingHitlResumeToTurn,
  clearCodingHitlResumePending,
  clearCodingHitlResumeMeta
};
