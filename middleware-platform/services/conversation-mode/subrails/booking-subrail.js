'use strict';

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

function stepTools(step) {
  if (step === 'confirm' || step === 'schedule') return ['schedule_appointment'];
  if (['slot_lookup', 'slot_select'].includes(step)) return ['get_available_slots'];
  return [];
}

async function handleBookingSubrail(ctx = {}) {
  const step = ctx.active_subrail_step || 'intent_confirm';
  const idx = BOOKING_STEPS.indexOf(step);
  const nextStep = BOOKING_STEPS[Math.min(idx + 1, BOOKING_STEPS.length - 1)];
  const msg = String(ctx.message || '').toLowerCase();

  let reply = STEP_PROMPTS[step] || STEP_PROMPTS.intent_confirm;
  let endCall = false;
  let disposition = null;
  const stateUpdates = { active_subrail: 'booking', active_subrail_step: nextStep };

  if (/no slots|nothing available|fully booked/.test(msg)) {
    reply = 'I do not see any openings that match. Would you like me to check a different day or provider?';
    disposition = 'booking_conflict';
    stateUpdates.booking_conflict = true;
  }

  if (
    step === 'slot_select' &&
    /\d|monday|tuesday|wednesday|thursday|friday|morning|afternoon|pm|am|lunes|martes|miércoles|miercoles|jueves|viernes|mañana|tarde|sí|si\b/.test(
      msg
    )
  ) {
    stateUpdates.current_booking_slot = {
      slot_id: `slot_${Date.now()}`,
      date: 'pending',
      time: msg.trim().slice(0, 40),
      specialty: ctx.specialty || 'general',
      provider: ctx.provider || 'available'
    };
    stateUpdates.active_subrail_step = 'contact_confirm';
    reply = STEP_PROMPTS.contact_confirm;
  }

  if (step === 'confirm') {
    endCall = false;
    const hasAppt = !!(ctx.appointment_id || ctx.flags?.last_appointment_id || ctx.flags?.appointment_id);
    if (hasAppt) disposition = 'completed';
  }

  return {
    reply,
    endCall,
    toolsUsed: stepTools(step),
    active_subrail: 'booking',
    active_subrail_step: stateUpdates.active_subrail_step,
    state_updates: stateUpdates,
    disposition,
    use_kelly: KELLY_BOOKING_STEPS.has(step)
  };
}

module.exports = { handleBookingSubrail, BOOKING_STEPS, STEP_PROMPTS };
