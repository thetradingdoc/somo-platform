'use strict';

const CANCEL_STEPS = ['find_booking', 'confirm_cancel', 'cancel_execute', 'confirm_message'];

const STEP_PROMPTS = {
  find_booking: 'I can help cancel your appointment. Can you confirm the date of the appointment you want to cancel?',
  find_booking_lookup: 'Let me look up your appointment details for you.',
  confirm_cancel: 'Just to confirm — you want to cancel this appointment. Is that correct?',
  cancel_execute: 'I am canceling that appointment now.',
  confirm_message: 'Your appointment has been canceled. Is there anything else I can help with?'
};

async function handleCancellationSubrail(ctx = {}) {
  const step = ctx.active_subrail_step || 'find_booking';
  const idx = CANCEL_STEPS.indexOf(step);
  let nextStep = CANCEL_STEPS[Math.min(idx + 1, CANCEL_STEPS.length - 1)];
  const msg = String(ctx.message || '').toLowerCase();
  const lookupOnly = !!(ctx.appt_lookup_only || ctx.flags?.appt_lookup_only);

  let reply =
    step === 'find_booking' && lookupOnly ? STEP_PROMPTS.find_booking_lookup : STEP_PROMPTS[step] || STEP_PROMPTS.find_booking;
  const stateUpdates = {
    active_subrail: 'cancellation',
    current_booking_slot: null,
    opqrst_frozen: true
  };

  if (/reschedule instead|reschedule|different time|move it/.test(msg)) {
    return {
      reply: 'No problem — let me help you reschedule instead.',
      active_subrail: 'booking',
      active_subrail_step: 'intent_confirm',
      state_updates: {
        active_subrail: 'booking',
        active_subrail_step: 'intent_confirm',
        cancellation_context: ctx.cancellation_context || null,
        pivot_reason: 'cancel_to_booking'
      },
      use_kelly: true
    };
  }

  if (step === 'confirm_cancel' && /yes|correct|yeah|yep/.test(msg)) {
    nextStep = 'cancel_execute';
    stateUpdates.cancellation_context = {
      appointment_id: ctx.cancellation_context?.appointment_id || ctx.appointment_id || null,
      reason: msg,
      confirmed: true
    };
    reply = STEP_PROMPTS.cancel_execute;
  }

  stateUpdates.active_subrail_step = nextStep;

  return {
    reply,
    endCall: false,
    toolsUsed: step === 'cancel_execute' ? ['cancel_appointment', 'search_appointments'] : ['search_appointments'],
    active_subrail: 'cancellation',
    active_subrail_step: nextStep,
    state_updates: stateUpdates,
    use_kelly: (step === 'find_booking' && lookupOnly) || step === 'cancel_execute'
  };
}

module.exports = { handleCancellationSubrail, CANCEL_STEPS, STEP_PROMPTS };
