'use strict';

const { UserIntent } = require('./conversation-mode-types');
const { EMERGENCY_SIGNALS, PAYMENT_SIGNALS, RECORDS_SIGNALS, CLINICAL_SIGNALS } = require('../kelly/rails/state-schema');
const { normalizeForIntentDetection } = require('./asr-normalize');

const BILLING_PIVOT_PHRASES = [
  'pay copay',
  'pay my copay',
  'pay the copay',
  'copay',
  'balance',
  'invoice',
  'payment link',
  'pay my bill',
  'pay now',
  'outstanding balance',
  'what do i owe',
  'amount due',
  '付款',
  '支付',
  '诊费'
];

const APPT_LOOKUP_PHRASES = [
  'calling about my appointment',
  'about my appointment',
  'upcoming appointment',
  'confirm the date',
  'confirm my appointment',
  'appointment details',
  'when is my appointment',
  'my appointment time',
  'question about my visit'
];

const CANCEL_PHRASES = [
  'cancel my appointment',
  'cancel appointment',
  'cancel my visit',
  'need to cancel',
  'cancel the appointment',
  'cancelar mi cita',
  'cancelar cita'
];

const RESCHEDULE_PHRASES = [
  'reschedule',
  'move my appointment',
  'change my appointment',
  'different time',
  'reprogramar',
  'cambiar mi cita'
];

const BOOK_PHRASES = [
  'book appointment',
  'book an appointment',
  'schedule appointment',
  'make an appointment',
  'make a booking',
  'need an appointment',
  'need to book',
  'book a',
  'book an',
  'can i book',
  'i want to book',
  'schedule a visit',
  'just booking',
  'a booking',
  'booking appointment',
  'booking a visit',
  'agendar cita',
  'hacer una cita',
  'reservar',
  'quiero reservar',
  'necesito una cita',
  'cita de',
  'reservar una cita'
];

const CANCEL_REBOOK_PHRASES = [
  'cancel and rebook',
  'cancel and book',
  'cancel this and book',
  'cancel it and book',
  'book another time',
  'book a new time',
  'new appointment instead',
  'book a different time instead',
  'cancel my appointment and book'
];

const HANDOFF_PHRASES = [
  'speak to someone',
  'talk to a person',
  'human',
  'representative',
  'operator',
  'real person',
  'connect me to',
  'speak to the',
  'talk to the',
  'what do you do',
  'what do you guys do',
  'what does somo do',
  'speak with someone'
];

// Vague symptom phrases that strongly imply a clinical issue without naming a body part.
const VAGUE_SYMPTOM_PHRASES = [
  "i don't feel well",
  'i do not feel well',
  "i'm not feeling well",
  'im not feeling well',
  'not feeling well',
  'i feel sick',
  'feel sick',
  'i feel awful',
  'i feel terrible',
  "i don't feel good",
  'i do not feel good'
];

/** Intent priority for multi-intent utterances (lower = higher priority). */
const INTENT_PRIORITY = {
  [UserIntent.EMERGENCY]: 0,
  [UserIntent.PAY_COPAY]: 1,
  [UserIntent.CANCEL]: 2,
  [UserIntent.APPT_LOOKUP]: 2.5,
  [UserIntent.RESCHEDULE]: 3,
  [UserIntent.BOOK]: 4,
  [UserIntent.RECORDS]: 4.5,
  [UserIntent.SYMPTOM]: 5,
  [UserIntent.BILLING_FAQ]: 7,
  [UserIntent.HANDOFF]: 8,
  [UserIntent.GENERAL]: 99
};

function normalizeMsg(msg) {
  return String(msg || '').toLowerCase().trim();
}

function matchesAny(msg, phrases) {
  return phrases.some((p) => msg.includes(p));
}

function isContactCaptureUtterance(msg) {
  const m = normalizeMsg(msg);
  if (!m) return false;
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(m)) return true;
  if (/\b(at gmail|at yahoo|at hotmail|dot com|dot org)\b/i.test(m)) return true;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(m)) return true;
  return false;
}

const SYMPTOM_EVIDENCE_RE =
  /\b(rash|itch|pain|hurt|hurting|ache|aching|sore|fever|burn|swollen|bleeding|nausea|cough|headache|dizzy|symptom|erupcion|erupción|picor|comezón|comezon|dolor|duele|me duele|fiebre)\b/i;

function hasSymptomEvidence(msg) {
  const m = normalizeMsg(msg);
  if (!m || isContactCaptureUtterance(m)) return false;
  if (SYMPTOM_EVIDENCE_RE.test(m)) return true;
  return matchesAny(m, VAGUE_SYMPTOM_PHRASES);
}

function isAdminBookingPhrase(msg) {
  if (/\b(rash|itch|pain|hurt|symptom|fever|burn|swollen|erupcion|erupción|picor|comezón|comezon|dolor)\b/.test(msg)) {
    return false;
  }
  return (
    matchesAny(msg, BOOK_PHRASES) ||
    isCancelRebookUtterance(msg) ||
    /\bbook\b.*\b(appointment|visit|cita|booking)\b/.test(msg) ||
    /\b(appointment|visit|cita|booking)\b.*\bbook\b/.test(msg) ||
    /\bmake a booking\b/.test(msg) ||
    /\bcan i (just )?book\b/.test(msg) ||
    /\b(just )?booking\b/.test(msg) ||
    /\bschedule a visit\b/.test(msg) ||
    /\b(available|times|slots|openings)\b.*\b(appointment|visit|time)\b/.test(msg) ||
    /\bwhat time/.test(msg)
  );
}

function isEmergency(msg) {
  const m = normalizeMsg(msg);
  if (/\b(not an emergency|no emergency)\b/.test(m)) return false;
  return EMERGENCY_SIGNALS.some((s) => m.includes(s));
}

function detectIntents(utterance) {
  const { normalized } = normalizeForIntentDetection(utterance);
  const msg = normalizeMsg(normalized || utterance);
  const intents = [];

  if (!msg) return [{ intent: UserIntent.GENERAL, confidence: 0.5 }];

  if (isEmergency(msg)) intents.push({ intent: UserIntent.EMERGENCY, confidence: 0.95 });

  if (matchesAny(msg, BILLING_PIVOT_PHRASES) || PAYMENT_SIGNALS.some((s) => msg.includes(s))) {
    intents.push({ intent: UserIntent.PAY_COPAY, confidence: 0.9 });
  }

  if (matchesAny(msg, CANCEL_PHRASES) || isCancelRebookUtterance(msg)) {
    intents.push({ intent: UserIntent.CANCEL, confidence: 0.9 });
  }

  if (matchesAny(msg, APPT_LOOKUP_PHRASES)) {
    intents.push({ intent: UserIntent.APPT_LOOKUP, confidence: 0.88 });
  }

  if (matchesAny(msg, RESCHEDULE_PHRASES)) {
    intents.push({ intent: UserIntent.RESCHEDULE, confidence: 0.85 });
  }

  if (isAdminBookingPhrase(msg)) {
    intents.push({ intent: UserIntent.BOOK, confidence: 0.85 });
  }

  if (isContactCaptureUtterance(msg)) {
    intents.push({ intent: UserIntent.GENERAL, confidence: 0.7 });
  }

  const hasRecordsSignals =
    RECORDS_SIGNALS.some((s) => msg.includes(s)) || /medical record|health record|my chart/.test(msg);

  if (
    !isContactCaptureUtterance(msg) &&
    CLINICAL_SIGNALS.some((s) => msg.includes(s)) &&
    !isAdminBookingPhrase(msg)
  ) {
    if (!hasRecordsSignals && hasSymptomEvidence(msg)) {
      intents.push({ intent: UserIntent.SYMPTOM, confidence: 0.8 });
    }
  }

  if (
    !intents.some((i) => i.intent === UserIntent.SYMPTOM || i.intent === UserIntent.EMERGENCY) &&
    !isContactCaptureUtterance(msg) &&
    matchesAny(msg, VAGUE_SYMPTOM_PHRASES)
  ) {
    intents.push({ intent: UserIntent.SYMPTOM, confidence: 0.75 });
  }

  if (RECORDS_SIGNALS.some((s) => msg.includes(s)) || /medical record|health record|my chart/.test(msg)) {
    intents.push({ intent: UserIntent.RECORDS, confidence: 0.85 });
  }

  if (matchesAny(msg, HANDOFF_PHRASES)) {
    intents.push({ intent: UserIntent.HANDOFF, confidence: 0.85 });
  }

  if (intents.length === 0) {
    intents.push({ intent: UserIntent.GENERAL, confidence: 0.5 });
  }

  intents.sort((a, b) => (INTENT_PRIORITY[a.intent] ?? 50) - (INTENT_PRIORITY[b.intent] ?? 50));
  return intents;
}

function isCancelRebookUtterance(utterance) {
  const msg = normalizeMsg(utterance);
  if (matchesAny(msg, CANCEL_REBOOK_PHRASES)) return true;
  return /cancel/.test(msg) && /book|rebook|new (time|appointment|slot)/.test(msg);
}

function primaryIntent(utterance) {
  const intents = detectIntents(utterance);
  return intents[0] || { intent: UserIntent.GENERAL, confidence: 0.5 };
}

function secondaryIntents(utterance) {
  const intents = detectIntents(utterance);
  return intents.slice(1);
}

module.exports = {
  BILLING_PIVOT_PHRASES,
  CANCEL_PHRASES,
  CANCEL_REBOOK_PHRASES,
  RESCHEDULE_PHRASES,
  APPT_LOOKUP_PHRASES,
  BOOK_PHRASES,
  INTENT_PRIORITY,
  detectIntents,
  primaryIntent,
  secondaryIntents,
  isEmergency,
  isCancelRebookUtterance,
  isContactCaptureUtterance,
  hasSymptomEvidence,
  isAdminBookingPhrase
};
