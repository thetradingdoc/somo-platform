'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { getDeterministicReply } = require('./prompts/deterministic');

const CANCEL_ONLY_RE =
  /\b(canceled|cancelled|has been cancel|ha sido cancelad|отменен|отменена)\b/i;
const RESCHEDULE_RE =
  /\b(rescheduled|reprogramad|перенесен|перенесена|moved to|nuevo horario|новое время)\b/i;

function isCancelOnlyReply(reply) {
  const text = String(reply || '');
  return CANCEL_ONLY_RE.test(text) && !RESCHEDULE_RE.test(text);
}

/**
 * When reschedule_appointment ran but the spoken reply is cancel-only, swap to appt_rescheduled.
 */
function repairRescheduleOverCancel(reply, state = {}, toolsUsed = [], ctx = {}) {
  if (!(toolsUsed || []).includes('reschedule_appointment')) return reply;
  if (!isCancelOnlyReply(reply)) return reply;
  const when = [
    KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_date'),
    KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_time')
  ]
    .filter(Boolean)
    .join(' at ');
  return getDeterministicReply('appt_rescheduled', state.locale || ctx.locale || 'en', {
    when: when || 'your new time'
  });
}

module.exports = {
  repairRescheduleOverCancel,
  isCancelOnlyReply,
  CANCEL_ONLY_RE,
  RESCHEDULE_RE
};
