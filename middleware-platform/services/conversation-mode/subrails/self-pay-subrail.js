'use strict';

const { Handoff } = require('../handoff-types');

const SELF_PAY_STEPS = ['identify', 'quote', 'payment_link', 'confirm'];

const STEP_PROMPTS = {
  identify:
    'I can help with your visit cost. Can you confirm your name and date of birth so I can look up self-pay pricing?',
  quote:
    'Thanks. For this visit our self-pay rate applies. Should I send a secure payment link to your phone?',
  payment_link:
    'I have sent a secure payment link to your phone. Please complete payment there — we never collect card numbers over the phone.',
  confirm: 'Thank you. Is there anything else I can help you with today?'
};

async function handleSelfPaySubrail(ctx = {}) {
  const step = ctx.self_pay_step || ctx.active_subrail_step || 'identify';
  const msg = String(ctx.message || '').toLowerCase();

  if (/human|person|staff|representative/.test(msg)) {
    return {
      reply: 'Let me connect you with our front desk team.',
      active_subrail: 'handoff',
      handoff: Handoff.KELLY_REQUIRED,
      disposition: 'handoff_requested'
    };
  }

  let nextStep = step;
  if (step === 'identify' && /yes|correct|that's me|yeah/.test(msg)) {
    nextStep = 'quote';
  } else if (step === 'quote' && /yes|send|sure|okay|ok/.test(msg)) {
    nextStep = 'payment_link';
  } else if (step === 'payment_link' && /done|paid|received|thanks/.test(msg)) {
    nextStep = 'confirm';
  }

  return {
    reply: STEP_PROMPTS[nextStep] || STEP_PROMPTS.identify,
    active_subrail: 'self_pay',
    self_pay_step: nextStep,
    kelly_lane_hint: 'payment'
  };
}

module.exports = { handleSelfPaySubrail, SELF_PAY_STEPS, STEP_PROMPTS };
