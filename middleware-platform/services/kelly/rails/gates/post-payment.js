'use strict';

const { KELLY_LANE } = require('../state-schema');
const { getDeterministicReply } = require('../prompts/deterministic');
const { withStickyLocale } = require('../resolve-locale');
const { readAppointmentRowById, formatAppointmentWhen } = require('../appointment-read');
const { KellyToolExecutor, sessionRow, argsFromMeta } = require('./shared');

async function runDeterministicPostPaymentConfirmation(state, ctx) {
  if (state.active_lane !== KELLY_LANE.POST_PAYMENT) return null;

  const apptId = state.flags.appointment_id || argsFromMeta(ctx.sessionId, 'last_appointment_id');
  let when = '';
  let specialty = 'your visit';
  const dateMeta = argsFromMeta(ctx.sessionId, 'last_slot_date');
  const timeMeta = argsFromMeta(ctx.sessionId, 'last_slot_time');
  if (dateMeta || timeMeta) {
    when = [dateMeta, timeMeta].filter(Boolean).join(' at ');
  }

  if (apptId) {
    const row = readAppointmentRowById(apptId);
    if (row) {
      when = when || formatAppointmentWhen(row);
      if (row.specialty) specialty = row.specialty;
    }
  }

  const row = sessionRow(ctx.sessionId);
  if (row?.target_specialty) specialty = row.target_specialty;

  const paidNote = state.flags.payment_complete
    ? ' We have your copay payment on file.'
    : state.flags.payment_token
      ? ' Your secure payment link was sent if you still need to pay.'
      : '';

  const locale = withStickyLocale(state).locale;
  const whenPart = when ? ` scheduled for ${when}` : ' on file';
  const reply = getDeterministicReply('post_payment_confirmed', locale, {
    specialty,
    when: whenPart,
    paid_note: paidNote
  });

  state.step = 'done';
  state.flags.post_visit_confirmation_pending = false;
  try {
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'post_visit_confirmation_pending', '0');
  } catch (_) {}

  return { reply, toolsUsed: ['get_triage_session'], endCall: false };
}

module.exports = { runDeterministicPostPaymentConfirmation };
