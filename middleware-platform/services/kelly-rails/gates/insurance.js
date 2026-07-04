'use strict';

const KellyToolExecutor = require('../../kelly-tool-executor');
const { KELLY_LANE, PAYMENT_SIGNALS } = require('../state-schema');
const { getDeterministicReply } = require('../prompts/deterministic');
const { withStickyLocale } = require('../resolve-locale');
const { executeDeterministicTool } = require('./shared');

const KNOWN_PAYERS = [
  'delta dental',
  'met life',
  'metlife',
  'blue cross',
  'blue shield',
  'aetna',
  'cigna',
  'anthem',
  'humana',
  'united',
  'medicare',
  'medicaid'
];

function extractPayerName(message) {
  const lower = String(message || '').toLowerCase();
  for (const payer of KNOWN_PAYERS) {
    if (lower.includes(payer)) return payer;
  }
  const match = lower.match(/\b(aetna|cigna|anthem|humana|metlife|delta)\b/i);
  return match ? match[1] : null;
}

function hasCarrierMention(message) {
  const lower = String(message || '').toLowerCase();
  return (
    !!extractPayerName(message) ||
    /i have |i've got |my insurance|tengo |у меня |seguro |страхов/i.test(lower)
  );
}

function isInsuranceAcceptanceInquiry(message) {
  const lower = String(message || '').toLowerCase();
  return /accept.*(insurance|medicaid|medicare)|aceptan.*seguro|toman.*seguro|take.*medicaid/i.test(lower);
}

async function runDeterministicInsurance(state, ctx) {
  if (state.active_lane !== KELLY_LANE.PAYMENT) return null;
  if (state.step !== 'insurance' && state.step !== 'front_desk_insurance') return null;

  const msg = String(ctx.message || '');
  const lower = msg.toLowerCase();
  if (isInsuranceAcceptanceInquiry(msg) && !/how much|copay|copago|cuánto|cuanto|cost|pagar|pay|сколько/i.test(lower)) {
    return null;
  }
  const billingContext =
    state.conversation_mode === 'tenant_billing' ||
    state.active_subrail === 'copay_link' ||
    PAYMENT_SIGNALS.some((s) => lower.includes(s));

  if (!billingContext) return null;
  const sessionId = ctx.sessionId;
  const quoteDelivered =
    KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') === '1' ||
    state.flags.quote_delivered === '1' ||
    state.flags.last_quote_status === 'hard_number';
  if (quoteDelivered && PAYMENT_SIGNALS.some((s) => lower.includes(s)) && !hasCarrierMention(msg)) {
    return null;
  }
  if (!hasCarrierMention(msg)) return null;

  const dob =
    KellyToolExecutor._getSessionMeta(sessionId, 'fd_dob') ||
    KellyToolExecutor._getSessionMeta(sessionId, 'date_of_birth');
  if (!dob) {
    return {
      reply: getDeterministicReply('insurance_need_dob', withStickyLocale(state).locale),
      toolsUsed: [],
      endCall: false
    };
  }

  const visitReason =
    KellyToolExecutor._getSessionMeta(sessionId, 'fd_reason_for_visit') ||
    KellyToolExecutor._getSessionMeta(sessionId, 'reason_for_visit') ||
    KellyToolExecutor._getSessionMeta(sessionId, 'visit_reason') ||
    'copay inquiry';

  const out = await executeDeterministicTool(
    KELLY_LANE.PAYMENT,
    'insurance',
    'collect_insurance',
    {
      date_of_birth: dob,
      visit_reason: visitReason,
      payer_name: extractPayerName(msg),
      clinic_id: ctx.clinicId,
      customer_id: ctx.customerId,
      patient_id: ctx.patientId,
      deliver_quote: true,
      spoken_quote: true
    },
    ctx
  );

  if (!out?.success) {
    return {
      reply:
        out?.message ||
        getDeterministicReply('insurance_pending', withStickyLocale(state).locale) ||
        'I could not verify coverage yet. Our team can follow up with a quote.',
      toolsUsed: [],
      endCall: false
    };
  }

  state.flags.insurance_collected = true;
  state.flags.insurance_verified = true;
  const copay =
    out.copay_due_now ??
    out.amount_resolution?.amount ??
    out.coverage?.copay_amount ??
    KellyToolExecutor._getSessionMeta(sessionId, 'copay_amount');
  if (copay != null && Number.isFinite(Number(copay))) {
    state.flags.copay_amount = Number(copay);
    KellyToolExecutor._setSessionMeta(sessionId, 'copay_amount', String(copay));
  }

  const locale = withStickyLocale(state).locale;
  const amount =
    copay != null && Number.isFinite(Number(copay)) ? Number(copay).toFixed(2) : null;
  const reply =
    amount != null
      ? getDeterministicReply('insurance_quote', locale, { amount })
      : out.message || getDeterministicReply('insurance_verified', locale);

  return { reply, toolsUsed: ['collect_insurance'], endCall: false };
}

module.exports = { runDeterministicInsurance };
