'use strict';

const { BillingStep } = require('../conversation-mode-types');

const BILLING_STEPS = [
  BillingStep.IDENTIFY_ACCOUNT,
  BillingStep.AMOUNT_CONFIRM,
  BillingStep.LINK_SENT,
  BillingStep.RECEIPT_CONFIRM
];

const STEP_PROMPTS = {
  [BillingStep.IDENTIFY_ACCOUNT]:
    'I can help with your copay. Can you confirm your name and date of birth so I can find your account?',
  [BillingStep.AMOUNT_CONFIRM]:
    'I found your account. Your copay amount is ready to confirm. Should I send a secure payment link to your phone?',
  [BillingStep.LINK_SENT]:
    'I have sent a secure payment link to your phone. Please complete payment there — we never collect card numbers over the phone.',
  [BillingStep.RECEIPT_CONFIRM]:
    'Thank you. Your payment has been received. Is there anything else I can help with?'
};

async function handleCopayLinkSubrail(ctx = {}) {
  const step = ctx.billing_step || ctx.active_subrail_step || BillingStep.IDENTIFY_ACCOUNT;
  const idx = BILLING_STEPS.indexOf(step);
  let nextStep = BILLING_STEPS[Math.min(idx + 1, BILLING_STEPS.length - 1)];
  const msg = String(ctx.message || '').toLowerCase();
  const retryCount = ctx.billing_retry_count || 0;

  let reply = STEP_PROMPTS[step] || STEP_PROMPTS[BillingStep.IDENTIFY_ACCOUNT];
  let disposition = null;
  let endCall = false;

  if (/failed|didn't work|not working|error/.test(msg) && step === BillingStep.LINK_SENT) {
    if (retryCount < 1) {
      return {
        reply: 'Sorry about that. Let me try sending the payment link again.',
        active_subrail: 'copay_link',
        billing_step: BillingStep.LINK_SENT,
        billing_retry_count: retryCount + 1,
        toolsUsed: ['request_patient_payment'],
        use_kelly: true
      };
    }
    return {
      reply:
        'I was not able to complete the payment link. Let me connect you with our billing team who can help.',
      active_subrail: 'handoff',
      disposition: 'handoff_failed',
      flags: { payment_failed: true, handoff_failed: true, pending_human_handoff: true },
      use_kelly: true
    };
  }

  if (step === BillingStep.AMOUNT_CONFIRM && /yes|send|sure|okay|ok|是|好|请|发送|短信|链接/.test(msg)) {
    nextStep = BillingStep.LINK_SENT;
    reply = STEP_PROMPTS[BillingStep.LINK_SENT];
  }

  if (step === BillingStep.RECEIPT_CONFIRM) {
    disposition = 'completed';
    const pending = ctx.pending_intent_queue || [];
    if (pending.length > 0) {
      reply += ' I also noted you wanted help with something else — I can take care of that next.';
    }
  }

  return {
    reply,
    endCall,
    toolsUsed: [BillingStep.LINK_SENT, BillingStep.AMOUNT_CONFIRM].includes(step)
      ? ['request_patient_payment']
      : ['get_patient_claims'],
    active_subrail: 'copay_link',
    billing_step: nextStep,
    active_subrail_step: nextStep,
    state_updates: { billing_step: nextStep, active_subrail: 'copay_link' },
    disposition,
    use_kelly: true,
    drain_pending_intents: step === BillingStep.RECEIPT_CONFIRM
  };
}

module.exports = { handleCopayLinkSubrail, BILLING_STEPS, STEP_PROMPTS };
