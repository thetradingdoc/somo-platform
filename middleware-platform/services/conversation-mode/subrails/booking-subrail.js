'use strict';

const { Handoff } = require('../handoff-types');
const {
  detectBookingIntents,
  parseProviderFromMessage
} = require('../../kelly-rails/turn-planner');

const BOOKING_STEPS = [
  'intent_confirm',
  'slot_lookup',
  'slot_select',
  'contact_confirm',
  'schedule',
  'confirm'
];

const STEP_PROMPTS = {
  intent_confirm: 'I can help you book an appointment. What type of visit do you need?',
  slot_lookup: 'Let me check available times for you.',
  slot_select: 'I found some openings. Which day and time works best for you?',
  contact_confirm: 'Can I confirm your name and callback number before I schedule this?',
  schedule: 'I am scheduling that appointment now.',
  confirm: 'Your appointment is confirmed. You will receive a confirmation shortly.'
};

const KELLY_BOOKING_STEPS = new Set(['slot_lookup', 'slot_select', 'contact_confirm', 'schedule', 'confirm']);

async function handleBookingSubrail(ctx = {}) {
  const step = ctx.active_subrail_step || 'intent_confirm';
  const idx = BOOKING_STEPS.indexOf(step);
  const nextStep = BOOKING_STEPS[Math.min(idx + 1, BOOKING_STEPS.length - 1)];
  const msg = String(ctx.message || '').toLowerCase();

  let reply = STEP_PROMPTS[step] || STEP_PROMPTS.intent_confirm;
  let endCall = false;
  let disposition = null;
  const stateUpdates = { active_subrail: 'booking', active_subrail_step: nextStep };
  const bookingIntents = detectBookingIntents(ctx.message, step);
  if (bookingIntents.length) {
    stateUpdates.booking_intents = bookingIntents;
  }

  if (step === 'slot_lookup' && !ctx.flags?.last_slot_bundles?.length && !ctx.flags?._slot_lookup_done) {
    stateUpdates._slot_lookup_done = true;
    return {
      reply: null,
      endCall: false,
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      state_updates: stateUpdates,
      handoff: Handoff.KELLY_REQUIRED,
      kelly_lane_hint: 'booking'
    };
  }

  if (/no slots|nothing available|fully booked/.test(msg)) {
    reply = 'I do not see any openings that match. Would you like me to check a different day or provider?';
    disposition = 'booking_conflict';
    stateUpdates.booking_conflict = true;
  }

  const providerNamed = parseProviderFromMessage(ctx.message);
  if (providerNamed && (step === 'slot_select' || step === 'slot_lookup')) {
    stateUpdates.provider_preference = providerNamed;
    const slotBundles = ctx.flags?._conflict_slot_bundles || ctx.flags?.last_slot_bundles || [];
    if (slotBundles.length) {
      const match = slotBundles.some((b) =>
        String(b.practitioner_name || '').toLowerCase().includes(providerNamed.toLowerCase())
      );
      if (!match) {
        stateUpdates.provider_mismatch = true;
        stateUpdates.booking_conflict = true;
        stateUpdates.active_subrail_step = 'slot_select';
        return {
          reply: null,
          endCall: false,
          active_subrail: 'booking',
          active_subrail_step: 'slot_select',
          state_updates: stateUpdates,
          handoff: Handoff.KELLY_REQUIRED,
          kelly_lane_hint: 'booking'
        };
      }
    }
  }

  if (
    step === 'slot_select' &&
    bookingIntents.some((i) => i.type === 'slot_selected')
  ) {
    stateUpdates.active_subrail_step = 'contact_confirm';
    reply = STEP_PROMPTS.contact_confirm;
  }

  if (step === 'confirm') {
    endCall = false;
    const hasAppt = !!(
      ctx.flags?.schedule_appointment_success ||
      (ctx.appointment_id && ctx.flags?.last_appointment_id)
    );
    if (hasAppt) disposition = 'completed';
  }

  return {
    reply: KELLY_BOOKING_STEPS.has(step) ? null : reply,
    endCall,
    active_subrail: 'booking',
    active_subrail_step: stateUpdates.active_subrail_step,
    state_updates: stateUpdates,
    disposition,
    handoff: KELLY_BOOKING_STEPS.has(step) ? Handoff.KELLY_REQUIRED : Handoff.KELLY_OPTIONAL,
    kelly_lane_hint: 'booking'
  };
}

module.exports = { handleBookingSubrail, BOOKING_STEPS, STEP_PROMPTS, parseProviderFromMessage };
