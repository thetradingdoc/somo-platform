'use strict';

const KELLY_LANE = {
  ROUTER: 'router',
  BASIC_INTAKE: 'basic_intake',
  CLINICAL: 'clinical',
  BOOKING: 'booking',
  PAYMENT: 'payment',
  POST_PAYMENT: 'post_payment',
  RESCHEDULE: 'reschedule',
  ACCOUNT: 'account',
  RECORDS: 'records',
  EDUCATION: 'education',
  SUPPORT: 'support'
};

const LANE_FIRST_STEP = {
  [KELLY_LANE.BASIC_INTAKE]: 'identity',
  [KELLY_LANE.CLINICAL]: 'clinical_intake',
  [KELLY_LANE.BOOKING]: 'schedule_visit',
  [KELLY_LANE.PAYMENT]: 'pay_invoice',
  [KELLY_LANE.POST_PAYMENT]: 'finish',
  [KELLY_LANE.RESCHEDULE]: 'find_booking',
  [KELLY_LANE.ACCOUNT]: 'billing',
  [KELLY_LANE.RECORDS]: 'records_qa',
  [KELLY_LANE.EDUCATION]: 'education',
  [KELLY_LANE.SUPPORT]: 'faq'
};

const PAYMENT_SIGNALS = [
  'pay my copay',
  'pay the copay',
  'pay now',
  'payment link',
  'secure payment',
  'pay before',
  'send me a link',
  'pay $',
  'copay now'
];

const BILLING_FAQ_SIGNALS = [
  'receipt',
  'claim status',
  'refund',
  'deductible',
  'member id',
  'what\'s my balance',
  'my balance',
  'balance on my account'
];

const EMERGENCY_SIGNALS = [
  'chest pain',
  'crushing chest',
  'stroke',
  'face drooping',
  'slurred speech',
  'suicidal',
  'kill myself',
  'can\'t breathe',
  'difficulty breathing',
  'severe bleeding',
  'me duele el pecho',
  'dolor en el pecho',
  'dolor de pecho',
  'no puedo respirar',
  'no puedo respirar bien',
  'dificultad para respirar',
  'pensamientos suicidas',
  'quiero matarme'
];

const POST_VISIT_SIGNALS = [
  'what happens next',
  'what do i do now',
  'what should i do next',
  'confirmation',
  'confirm my appointment',
  'appointment details',
  'just paid',
  'i paid',
  'payment went through'
];

const RECORDS_SIGNALS = ['last visit', 'my records', 'medical history', 'what did my doctor'];

const CLINICAL_SIGNALS = [
  'see a doctor',
  'see a dermatolog',
  'appointment',
  'book',
  'visit',
  'clinic',
  'rash',
  'leg',
  'neck',
  'itch',
  'pain',
  'hurt',
  'hurting',
  'ache',
  'aching',
  'sore',
  'symptom',
  'fever',
  'pelvic',
  'gynecolog',
  'obgyn',
  'ob/gyn',
  'period',
  'dermatolog',
  'skin concern',
  'not an emergency',
  'erupcion',
  'erupción',
  'pierna',
  'cuello',
  'brazo',
  'dolor',
  'duele',
  'me duele',
  'síntoma',
  'sintoma',
  'fiebre',
  'cita',
  'doctor',
  'dermatolog',
  'visita',
  'clínica',
  'clinica',
  'picor',
  'comezón',
  'comezon',
  'no es una emergencia'
];

const EDUCATION_SIGNALS = [
  'moisturizer',
  'skincare',
  'skin type',
  'oily skin',
  'dry skin',
  'ingredient',
  'routine'
];

function defaultFlags() {
  return {
    routine_intake_active: false,
    triage_complete: false,
    has_rag: false,
    basic_intake_complete: false,
    appointment_id: null,
    copay_amount: null,
    payment_token: null,
    pending_human_handoff: false,
    booking_intent_seen: false,
    post_visit_confirmation_pending: false,
    payment_complete: false,
    safety_blocked: false
  };
}

function isEmergencyUtterance(msg) {
  const m = String(msg || '').toLowerCase();
  if (/\b(not an emergency|no emergency)\b/.test(m)) return false;
  return EMERGENCY_SIGNALS.some((s) => m.includes(s));
}

function isPostVisitUtterance(msg) {
  return POST_VISIT_SIGNALS.some((s) => String(msg || '').toLowerCase().includes(s));
}

function resolveLocale(input = {}) {
  const raw = input.locale || input.preferredLanguage || input.preferred_language || 'en';
  return String(raw).slice(0, 2) || 'en';
}

function normalizeState(input = {}) {
  const flags = { ...defaultFlags(), ...(input.flags || {}) };
  return {
    session_id: String(input.session_id || input.sessionId || '').trim(),
    clinic_id: input.clinic_id || input.clinicId || null,
    patient_id: input.patient_id || input.patientId || null,
    channel: input.channel || 'chat',
    locale: resolveLocale(input),
    active_lane: input.active_lane || KELLY_LANE.ROUTER,
    step: input.step || 'await_intent',
    flags,
    last_user_message: String(input.last_user_message || input.message || ''),
    last_reply: input.last_reply || '',
    tools_used_last_turn: Array.isArray(input.tools_used_last_turn) ? input.tools_used_last_turn : [],
    v2_hydrated: !!input.v2_hydrated
  };
}

function routeOrchestratorLane(state = {}) {
  const msg = String(state.last_user_message || '').toLowerCase();
  const flags = state.flags || {};

  if (flags.pending_human_handoff || flags.safety_blocked) {
    return { lane: KELLY_LANE.SUPPORT, step: 'handoff' };
  }

  if (isEmergencyUtterance(msg)) {
    return {
      lane: KELLY_LANE.SUPPORT,
      step: 'handoff',
      safety_blocked: true
    };
  }

  if (
    flags.appointment_id &&
    (flags.post_visit_confirmation_pending ||
      flags.payment_complete ||
      isPostVisitUtterance(msg))
  ) {
    return { lane: KELLY_LANE.POST_PAYMENT, step: 'confirmation' };
  }

  if (PAYMENT_SIGNALS.some((s) => msg.includes(s))) {
    if (paymentGateOpen(flags)) {
      return { lane: KELLY_LANE.PAYMENT, step: LANE_FIRST_STEP[KELLY_LANE.PAYMENT] };
    }
    if (flags.has_rag || flags.triage_complete) {
      return { lane: KELLY_LANE.BOOKING, step: 'schedule_visit' };
    }
    return { lane: KELLY_LANE.PAYMENT, step: LANE_FIRST_STEP[KELLY_LANE.PAYMENT] };
  }

  if (BILLING_FAQ_SIGNALS.some((s) => msg.includes(s))) {
    return { lane: KELLY_LANE.SUPPORT, step: LANE_FIRST_STEP[KELLY_LANE.SUPPORT] };
  }

  if (RECORDS_SIGNALS.some((s) => msg.includes(s))) {
    return { lane: KELLY_LANE.RECORDS, step: LANE_FIRST_STEP[KELLY_LANE.RECORDS] };
  }

  try {
    const KellyOrchestratorPhase = require('../kelly-orchestrator-phase');
    if (KellyOrchestratorPhase.isRescheduleCancelIntent(msg)) {
      return { lane: KELLY_LANE.RESCHEDULE, step: LANE_FIRST_STEP[KELLY_LANE.RESCHEDULE] };
    }
  } catch (_) {}

  const clinicalHit = CLINICAL_SIGNALS.some((s) => msg.includes(s));
  const educationHit = EDUCATION_SIGNALS.some((s) => msg.includes(s));

  if (flags.routine_intake_active && educationHit && !clinicalHit) {
    return { lane: KELLY_LANE.EDUCATION, step: LANE_FIRST_STEP[KELLY_LANE.EDUCATION] };
  }

  if (flags.routine_intake_active && clinicalHit) {
    return { lane: KELLY_LANE.CLINICAL, step: LANE_FIRST_STEP[KELLY_LANE.CLINICAL] };
  }

  if (clinicalHit && !flags.routine_intake_active) {
    if (!flags.basic_intake_complete) {
      return { lane: KELLY_LANE.CLINICAL, step: LANE_FIRST_STEP[KELLY_LANE.CLINICAL] };
    }
    return { lane: KELLY_LANE.CLINICAL, step: LANE_FIRST_STEP[KELLY_LANE.CLINICAL] };
  }

  if (flags.appointment_id && flags.copay_amount && /pay|copay|payment/i.test(msg)) {
    return { lane: KELLY_LANE.PAYMENT, step: LANE_FIRST_STEP[KELLY_LANE.PAYMENT] };
  }

  const db = require('../../database');
  const sessionRow = state.session_id && db.getTriageSession ? db.getTriageSession(state.session_id) : null;
  const opqrstOk =
    sessionRow &&
    String(sessionRow.quality || '').trim() &&
    String(sessionRow.onset || sessionRow.timing || '').trim() &&
    (sessionRow.severity != null || String(sessionRow.severity || '').trim()) &&
    String(sessionRow.region || sessionRow.body_site || '').trim();

  if (
    opqrstOk &&
    /book|schedule|appointment|slot|tomorrow|noon|12:00|12 pm|available/i.test(msg)
  ) {
    return { lane: KELLY_LANE.BOOKING, step: LANE_FIRST_STEP[KELLY_LANE.BOOKING] };
  }

  if (flags.has_rag && flags.triage_complete && /book|schedule|appointment|slot/i.test(msg)) {
    return { lane: KELLY_LANE.BOOKING, step: LANE_FIRST_STEP[KELLY_LANE.BOOKING] };
  }

  if (educationHit && flags.routine_intake_active) {
    return { lane: KELLY_LANE.EDUCATION, step: LANE_FIRST_STEP[KELLY_LANE.EDUCATION] };
  }

  if (educationHit && !flags.routine_intake_active) {
    if (clinicalHit) {
      return { lane: KELLY_LANE.CLINICAL, step: LANE_FIRST_STEP[KELLY_LANE.CLINICAL] };
    }
    return { lane: KELLY_LANE.SUPPORT, step: LANE_FIRST_STEP[KELLY_LANE.SUPPORT] };
  }

  if (clinicalHit) {
    return { lane: KELLY_LANE.CLINICAL, step: LANE_FIRST_STEP[KELLY_LANE.CLINICAL] };
  }

  return { lane: KELLY_LANE.BASIC_INTAKE, step: LANE_FIRST_STEP[KELLY_LANE.BASIC_INTAKE] };
}

function paymentGateOpen(flags = {}) {
  return !!(flags.appointment_id && flags.copay_amount != null);
}

module.exports = {
  KELLY_LANE,
  LANE_FIRST_STEP,
  defaultFlags,
  normalizeState,
  routeOrchestratorLane,
  paymentGateOpen,
  PAYMENT_SIGNALS,
  EMERGENCY_SIGNALS,
  POST_VISIT_SIGNALS,
  RECORDS_SIGNALS,
  isEmergencyUtterance,
  isPostVisitUtterance
};
