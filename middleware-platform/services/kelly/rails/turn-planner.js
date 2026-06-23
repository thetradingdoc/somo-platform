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

const CancelIntentType = {
  CANCEL_REQUESTED: 'cancel_requested',
  CONFIRM_CANCEL: 'confirm_cancel'
};

const RescheduleIntentType = {
  RESCHEDULE_REQUESTED: 'reschedule_requested',
  SLOT_SELECTED: 'slot_selected',
  CONFIRM_RESCHEDULE: 'confirm_reschedule'
};

const RecordsIntentType = {
  QUERY: 'records_query'
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

function detectBookingIntents(message, step) {
  const intents = [];
  const msg = String(message || '');
  const lower = msg.toLowerCase();

  const time = parseSlotTimeFromMessage(msg);
  if (time) intents.push({ type: BookingIntentType.SLOT_SELECTED, time });

  const provider = parseProviderFromMessage(msg);
  if (provider) intents.push({ type: BookingIntentType.PROVIDER_NAMED, provider });

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

function detectCancelIntents(message, step) {
  const intents = [];
  const lower = String(message || '').toLowerCase();
  if (/cancel|cancellation|no longer need|can't make|cannot make|no puedo/.test(lower)) {
    intents.push({ type: CancelIntentType.CANCEL_REQUESTED });
  }
  if (
    step === 'confirm_cancel' &&
    (isConfirmatoryUtterance(message) || /yes|confirm|go ahead|sí|si\b/.test(lower))
  ) {
    intents.push({ type: CancelIntentType.CONFIRM_CANCEL });
  }
  return intents;
}

function detectRescheduleIntents(message, step) {
  const intents = [];
  const msg = String(message || '');
  const lower = msg.toLowerCase();
  if (/reschedule|move my appointment|change my appointment|different time|reprogramar/.test(lower)) {
    intents.push({ type: RescheduleIntentType.RESCHEDULE_REQUESTED });
  }
  const time = parseSlotTimeFromMessage(msg);
  if (time) intents.push({ type: RescheduleIntentType.SLOT_SELECTED, time });
  if (
    step === 'move_or_cancel' &&
    (isConfirmatoryUtterance(msg) || /yes|confirm|works|sí|si\b/.test(lower))
  ) {
    intents.push({ type: RescheduleIntentType.CONFIRM_RESCHEDULE });
  }
  return intents;
}

function detectRecordsIntents(message) {
  const lower = String(message || '').toLowerCase();
  if (
    /last visit|my records|medical history|lab results|what did my doctor|health record|my chart/.test(
      lower
    )
  ) {
    return [{ type: RecordsIntentType.QUERY }];
  }
  return [];
}

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

function applyCancelIntentsToFlags(flags = {}, intents = []) {
  if (!intents.length) return flags;
  flags.cancel_intents = intents;
  if (intents.some((i) => i.type === CancelIntentType.CONFIRM_CANCEL)) {
    flags.cancel_confirmed = true;
    flags.cancel_pending = true;
  }
  if (intents.some((i) => i.type === CancelIntentType.CANCEL_REQUESTED)) {
    flags.cancel_pending = true;
  }
  return flags;
}

function applyRescheduleIntentsToFlags(flags = {}, intents = []) {
  if (!intents.length) return flags;
  flags.reschedule_intents = intents;
  if (intents.some((i) => i.type === RescheduleIntentType.RESCHEDULE_REQUESTED)) {
    flags.reschedule_pending = true;
  }
  for (const intent of intents) {
    if (intent.type === RescheduleIntentType.SLOT_SELECTED && intent.time) {
      flags._slot_selected_time = intent.time;
    }
  }
  return flags;
}

function applyRecordsIntentsToFlags(flags = {}, intents = []) {
  if (!intents.length) return flags;
  flags.records_intents = intents;
  return flags;
}

function planTurnOwner({ subrail, flags = {}, intents = [], step = null }) {
  if (subrail === 'booking') {
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

  if (subrail === 'cancellation') {
    const onFindStep = step === 'find_booking' || flags.active_subrail_step === 'find_booking';
    if (flags.appt_lookup_only) {
      return { owner: 'gate', gateId: 'lookup' };
    }
    if (flags.reschedule_pending) {
      if (!flags.lookup_complete) {
        return { owner: 'gate', gateId: 'lookup' };
      }
      return { owner: 'gate', gateId: 'reschedule' };
    }
    if (flags.cancel_find_pending && !flags.lookup_complete) {
      return { owner: 'gate', gateId: 'lookup' };
    }
    if (
      flags.cancel_pending ||
      flags.cancel_confirmed ||
      intents.some((i) => i.type === CancelIntentType.CONFIRM_CANCEL)
    ) {
      return { owner: 'gate', gateId: 'cancel' };
    }
    if (!flags.lookup_complete && onFindStep) {
      return { owner: 'gate', gateId: 'lookup' };
    }
    return { owner: 'llm' };
  }

  if (subrail === 'records_qa') {
    if (intents.some((i) => i.type === RecordsIntentType.QUERY) || flags.conversation_mode === 'tenant_records') {
      return { owner: 'gate', gateId: 'records' };
    }
    return { owner: 'llm' };
  }

  if (subrail === 'copay_link') {
    return { owner: 'gate', gateId: 'payment' };
  }

  return { owner: 'llm' };
}

module.exports = {
  BookingIntentType,
  CancelIntentType,
  RescheduleIntentType,
  RecordsIntentType,
  detectBookingIntents,
  detectCancelIntents,
  detectRescheduleIntents,
  detectRecordsIntents,
  applyBookingIntentsToFlags,
  applyCancelIntentsToFlags,
  applyRescheduleIntentsToFlags,
  applyRecordsIntentsToFlags,
  planTurnOwner,
  parseProviderFromMessage
};
