'use strict';

const { KELLY_LANE, PAYMENT_SIGNALS } = require('../state-schema');
const { getDeterministicReply } = require('../prompts/deterministic');
const { withStickyLocale } = require('../resolve-locale');
const { KellyToolExecutor, executeDeterministicTool } = require('./shared');

async function runDeterministicPayment(state, ctx) {
  if (state.active_lane !== KELLY_LANE.PAYMENT) return null;

  const { sessionId, clinicId, patientId, callerPhone, channel, message } = ctx;
  const msg = String(message || '').toLowerCase();
  const quoteDelivered =
    state.flags.quote_delivered === true ||
    state.flags.quote_delivered === '1' ||
    state.flags.last_quote_status === 'hard_number' ||
    KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') === '1';
  const onPayStep = state.step === 'pay_invoice';
  const paySignal = PAYMENT_SIGNALS.some((s) => msg.includes(s));
  if (!paySignal && !onPayStep) return null;
  if (!onPayStep && paySignal && !quoteDelivered) return null;

  let amount = state.flags.copay_amount;
  if (amount == null || !Number.isFinite(Number(amount))) {
    const metaCopay = KellyToolExecutor._getSessionMeta(sessionId, 'copay_amount');
    amount = metaCopay != null ? Number(metaCopay) : null;
  }
  if (amount == null || !Number.isFinite(Number(amount)) || amount < 0) {
    return {
      reply: getDeterministicReply('payment_defer', withStickyLocale(state).locale),
      toolsUsed: [],
      endCall: false
    };
  }

  const journeyId = KellyToolExecutor._getSessionMeta(sessionId, 'rcm_journey_id') || null;
  const out = await executeDeterministicTool(
    state.active_lane,
    state.step,
    'request_patient_payment',
    { amount: Number(amount), journey_id: journeyId, patient_id: patientId, delivery: 'both' },
    { sessionId, clinicId, patientId, callerPhone, channel }
  );

  if (!out?.success) return null;

  if (out.pay_token) {
    state.flags.payment_token = out.pay_token;
    KellyToolExecutor._setSessionMeta(sessionId, 'rcm_pay_token', out.pay_token);
  }
  state.flags.payment_complete = true;
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_complete', '1');
    if (state.flags.appointment_id) {
      KellyToolExecutor._setSessionMeta(sessionId, 'post_visit_confirmation_pending', '1');
      state.flags.post_visit_confirmation_pending = true;
    }
  } catch (_) {}

  const reply =
    out.pay_url
      ? getDeterministicReply('payment_link_sent', withStickyLocale(state).locale, {
          amount: Number(amount).toFixed(2)
        })
      : String(out.message || 'Your secure payment link is on the way.');

  return { reply, toolsUsed: ['request_patient_payment'], endCall: false };
}

module.exports = { runDeterministicPayment };
