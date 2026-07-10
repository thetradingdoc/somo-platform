'use strict';

const { Handoff } = require('../handoff-types');
const { detectCancelIntents } = require('../../kelly-rails/turn-planner');
const { isCancelFeeInquiry } = require('../intent-detector');

const CANCEL_STEPS = ['find_booking', 'confirm_cancel', 'cancel_execute', 'confirm_message'];

const STEP_PROMPTS = {
  find_booking: 'I can help cancel your appointment. Can you confirm the date of the appointment you want to cancel?',
  find_booking_lookup: 'Let me look up your appointment details for you.',
  confirm_cancel: 'Just to confirm — you want to cancel this appointment. Is that correct?',
  cancel_execute: 'I am canceling that appointment now.',
  confirm_message: 'Your appointment has been canceled. Is there anything else I can help with?'
};

function wantsRebook(msg) {
  return (
    /cancel and (re)?book|cancel this and book|book another time|book a new time|new appointment instead|book a different time instead/.test(
      msg
    ) || (/cancel/.test(msg) && /book|rebook|new (time|appointment)/.test(msg))
  );
}

async function handleCancellationSubrail(ctx = {}) {
  const step = ctx.active_subrail_step || 'find_booking';
  const msg = String(ctx.message || '').toLowerCase();
  const lookupOnly = !!(ctx.appt_lookup_only || ctx.flags?.appt_lookup_only);
  const cancelIntents = detectCancelIntents(ctx.message, step);

  const stateUpdates = {
    active_subrail: 'cancellation',
    opqrst_frozen: true
  };
  if (cancelIntents.length) {
    stateUpdates.cancel_intents = cancelIntents;
  }

  if (isCancelFeeInquiry(msg) && step !== 'confirm_message') {
    return {
      reply: null,
      endCall: false,
      active_subrail: 'cancellation',
      active_subrail_step: 'cancel_execute',
      state_updates: {
        ...stateUpdates,
        active_subrail_step: 'cancel_execute',
        cancel_confirmed: true,
        cancel_pending: true,
        cancel_fee_inquiry: true
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'cancel'
    };
  }

  if (
    (ctx.flags?.cancel_complete || step === 'confirm_message') &&
    /book|new time|schedule|another appointment|different day/.test(msg)
  ) {
    return {
      reply: null,
      endCall: false,
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      state_updates: {
        rebook_after_cancel: true,
        active_subrail: 'booking',
        active_subrail_step: 'slot_lookup',
        cancel_pending: false,
        cancel_complete: true,
        conversation_mode: 'tenant_inbound_admin'
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'booking'
    };
  }

  if (wantsRebook(msg)) {
    return {
      reply: null,
      endCall: false,
      active_subrail: 'cancellation',
      active_subrail_step: 'find_booking',
      state_updates: {
        ...stateUpdates,
        active_subrail_step: 'find_booking',
        rebook_after_cancel: true,
        cancel_find_pending: true
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'reschedule'
    };
  }

  if (
    !isCancelFeeInquiry(msg) &&
    /reschedule instead|reschedule my|move my appointment|move it to|move to next week|next week instead|reprogramar|cambiar mi cita|cambiarla|próxima semana|proxima semana|la próxima|podemos cambiar|перенести|на следующ/i.test(
      msg
    )
  ) {
    return {
      reply: 'No problem — let me help you reschedule instead.',
      active_subrail: 'cancellation',
      active_subrail_step: 'find_booking',
      state_updates: {
        active_subrail: 'cancellation',
        active_subrail_step: 'find_booking',
        cancellation_context: ctx.cancellation_context || null,
        pivot_reason: 'cancel_to_reschedule',
        reschedule_pending: true,
        cancel_pending: false,
        cancel_confirmed: false
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'reschedule'
    };
  }

  const wantsCancel =
    (/cancel|yes|correct|yeah|yep|go ahead|please cancel|отмен/i.test(msg) &&
      !/don't cancel|do not cancel/.test(msg)) ||
    /нужно отменить|отменить приём|отменить прием/i.test(msg);

  if (lookupOnly && step === 'find_booking') {
    return {
      reply: null,
      endCall: false,
      active_subrail: 'cancellation',
      active_subrail_step: 'find_booking',
      state_updates: {
        ...stateUpdates,
        active_subrail_step: 'find_booking',
        appt_lookup_only: true
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'cancel'
    };
  }

  if (step === 'find_booking' && !lookupOnly) {
    if (wantsCancel) {
      return {
        reply: null,
        endCall: false,
        active_subrail: 'cancellation',
        active_subrail_step: 'find_booking',
        state_updates: {
          ...stateUpdates,
          active_subrail_step: 'find_booking',
          cancel_find_pending: true
        },
        handoff: Handoff.KELLY_REQUIRED,
        kelly_lane_hint: 'cancel'
      };
    }
    return {
      reply: null,
      endCall: false,
      active_subrail: 'cancellation',
      active_subrail_step: 'find_booking',
      state_updates: {
        ...stateUpdates,
        active_subrail_step: 'find_booking',
        cancel_find_pending: true
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'cancel'
    };
  }

  if (step === 'confirm_cancel' && wantsCancel) {
    return {
      reply: null,
      endCall: false,
      active_subrail: 'cancellation',
      active_subrail_step: 'cancel_execute',
      state_updates: {
        ...stateUpdates,
        active_subrail_step: 'cancel_execute',
        cancel_confirmed: true,
        cancel_pending: true,
        cancellation_context: {
          appointment_id: ctx.cancellation_context?.appointment_id || ctx.appointment_id || null,
          reason: msg,
          confirmed: true
        }
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'cancel'
    };
  }

  if (step === 'cancel_execute' || (wantsCancel && step !== 'confirm_message')) {
    return {
      reply: null,
      endCall: false,
      active_subrail: 'cancellation',
      active_subrail_step: 'cancel_execute',
      state_updates: {
        ...stateUpdates,
        active_subrail_step: 'cancel_execute',
        cancel_confirmed: true,
        cancel_pending: true
      },
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'cancel'
    };
  }

  const idx = CANCEL_STEPS.indexOf(step);
  const nextStep = CANCEL_STEPS[Math.min(idx + 1, CANCEL_STEPS.length - 1)];
  const reply = STEP_PROMPTS[step] || STEP_PROMPTS.find_booking;
  stateUpdates.active_subrail_step = nextStep;

  return {
    reply,
    endCall: false,
    active_subrail: 'cancellation',
    active_subrail_step: nextStep,
    state_updates: stateUpdates,
    handoff: Handoff.KELLY_OPTIONAL,
    kelly_lane_hint: 'cancel'
  };
}

module.exports = { handleCancellationSubrail, CANCEL_STEPS, STEP_PROMPTS };
