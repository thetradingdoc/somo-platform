'use strict';

const { parseSlotTimeFromMessage } = require('./slot-time-parse');
const { isConfirmatoryUtterance } = require('./confirm-utterance');

/** L2 booking intents — subrails emit; L4 gates consume. */
const BookingIntentType = {
  SLOT_SELECTED: 'slot_selected',
  CONFIRM_BOOK: 'confirm_book',
  PROVIDER_NAMED: 'provider_named',
  ASK_AVAILABILITY: 'ask_availability'
};

function parseProviderFromMessage(message) {
  const msg = String(message || '');
  const drMatch = msg.match(
    /\b(?:dr\.?|doctor)\s+([A-Za-z][\sA-Za-z.-]{0,40}?)(?:\s+(?:at|on|for|works|tomorrow)\b|$)/i
  );
  if (drMatch) return drMatch[1].trim();
  const withMatch = msg.match(/\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (withMatch) return withMatch[1].trim();
  return null;
}

/** Detect booking intents from patient utterance (no slot meta writes). */
function detectBookingIntents(message, step) {
  const intents = [];
  const msg = String(message || '');
  const lower = msg.toLowerCase();

  const time = parseSlotTimeFromMessage(msg);
  if (time) {
    intents.push({ type: BookingIntentType.SLOT_SELECTED, time });
  }

  const provider = parseProviderFromMessage(msg);
  if (provider) {
    intents.push({ type: BookingIntentType.PROVIDER_NAMED, provider });
  }

  if (
    isConfirmatoryUtterance(msg) ||
    /book|confirm|go ahead|please book|schedule|reservar|por favor/.test(lower)
  ) {
    intents.push({ type: BookingIntentType.CONFIRM_BOOK });
  }

  if (/available|what times|openings|horarios|disponib/.test(lower)) {
    intents.push({ type: BookingIntentType.ASK_AVAILABILITY });
  }

  if (step === 'slot_lookup' && !intents.length && /appointment|book|schedule|next week/.test(lower)) {
    intents.push({ type: BookingIntentType.ASK_AVAILABILITY });
  }

  return intents;
}

/** Merge intents into flags without writing current_booking_slot (L4 owns slots). */
function applyBookingIntentsToFlags(flags = {}, intents = []) {
  if (!Array.isArray(intents) || !intents.length) return flags;
  flags.booking_intents = intents;

  for (const intent of intents) {
    if (intent.type === BookingIntentType.PROVIDER_NAMED && intent.provider) {
      flags.provider_preference = intent.provider;
    }
    if (intent.type === BookingIntentType.SLOT_SELECTED && intent.time) {
      flags._slot_selected_time = intent.time;
    }
  }
  return flags;
}

/**
 * Decide turn owner for booking path.
 * @returns {{ owner: 'gate'|'llm'|'script', gateId?: string }}
 */
function planTurnOwner({ subrail, flags = {}, intents = [] }) {
  if (subrail !== 'booking') {
    return { owner: 'llm' };
  }

  const hasConfirm = intents.some((i) => i.type === BookingIntentType.CONFIRM_BOOK);
  const hasSlot = intents.some((i) => i.type === BookingIntentType.SLOT_SELECTED);
  const hasBooked =
    flags.schedule_appointment_success || flags.last_appointment_id || flags.appointment_id;

  if (hasConfirm && (hasSlot || flags._slot_selected_time || flags.current_booking_slot?.time)) {
    return { owner: 'gate', gateId: 'schedule' };
  }
  if (hasSlot || flags._slot_selected_time) {
    return { owner: 'gate', gateId: 'schedule' };
  }
  if (flags.booking_conflict || flags.provider_mismatch) {
    return { owner: 'gate', gateId: 'conflict' };
  }
  if (hasBooked && hasConfirm) {
    return { owner: 'gate', gateId: 'schedule' };
  }
  if (intents.some((i) => i.type === BookingIntentType.ASK_AVAILABILITY)) {
    return { owner: 'gate', gateId: 'schedule' };
  }

  return { owner: 'llm' };
}

module.exports = {
  BookingIntentType,
  detectBookingIntents,
  applyBookingIntentsToFlags,
  planTurnOwner,
  parseProviderFromMessage
};
