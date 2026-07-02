'use strict';

/** Tool names allowed per lane step (tool-first rails). */

const { isOpqrstFieldGateEnabled } = require('./config');

const SKINCARE_ROUTINE_TOOLS = new Set([
  'evaluate_skincare_routine',
  'resolve_product_ingredients',
  'lookup_ingredient_functions',
  'retrieve_ingredient_monographs'
]);

const PAYMENT_AND_SCHEDULE_TOOLS = new Set([
  'schedule_appointment',
  'get_available_slots',
  'create_appointment_checkout',
  'request_patient_payment',
  'collect_insurance'
]);

/** Tools owned by L4 gates — stripped from LLM allowlists on gate-owned steps. */
const TRANSACTIONAL_GATE_TOOLS = new Set([
  'schedule_appointment',
  'create_appointment_checkout',
  'request_patient_payment',
  'cancel_appointment',
  'reschedule_appointment'
]);

const ALLOWLISTS = {
  basic_intake: {
    identity: ['get_triage_session'],
    contact: ['get_triage_session', 'store_triage_rich_intake'],
    policy: ['get_triage_session']
  },
  clinical: {
    clinical_intake: ['get_triage_session', 'store_triage_opqrst', 'store_triage_rich_intake'],
    medical_history: ['store_triage_rich_intake', 'get_triage_session'],
    medications: ['store_triage_rich_intake', 'get_triage_session'],
    symptoms: ['store_triage_opqrst', 'get_triage_session'],
    triage_assessment: ['run_triage_rag', 'collect_insurance', 'compute_visit_quote', 'get_triage_session', 'store_triage_opqrst']
  },
  booking: {
    schedule_visit: ['get_available_slots', 'get_triage_session'],
    confirm_visit: ['get_triage_session']
  },
  payment: {
    pay_invoice: ['get_triage_session', 'get_patient_claims'],
    insurance: ['collect_insurance', 'compute_visit_quote', 'get_patient_claims'],
    front_desk_insurance: ['collect_insurance', 'compute_visit_quote', 'get_patient_claims'],
    self_pay: ['compute_visit_quote', 'request_patient_payment', 'get_triage_session'],
    receipt_logic: ['get_patient_claims', 'request_patient_payment']
  },
  post_payment: {
    finish: ['get_triage_session'],
    scheduled: ['get_triage_session'],
    confirmation: ['get_triage_session']
  },
  reschedule: {
    find_booking: ['search_appointments'],
    move_or_cancel: ['reschedule_appointment', 'cancel_appointment', 'search_appointments']
  },
  account: {
    billing: ['get_patient_claims', 'request_patient_payment'],
    insurance: ['collect_insurance', 'get_patient_claims']
  },
  records: {
    records_qa: ['query_patient_records', 'get_triage_session'],
    fhir_read: ['query_patient_records', 'get_triage_session']
  },
  education: {
    education: [
      'evaluate_skincare_routine',
      'resolve_product_ingredients',
      'lookup_ingredient_functions',
      'retrieve_ingredient_monographs',
      'run_derm_patient_qa'
    ],
    clinical_advice: ['run_derm_patient_qa', 'search_medical_literature']
  },
  support: {
    faq: ['search_medical_literature', 'get_patient_claims'],
    handoff: ['get_triage_session']
  }
};

function isGateOwnedTransactionalStep(lane, step, flags = {}) {
  if (lane === 'booking' && step === 'confirm_visit') return true;
  if (lane === 'payment' && step === 'pay_invoice') return true;
  if (lane === 'reschedule' && step === 'move_or_cancel' && flags.cancel_pending) return true;
  if (lane === 'reschedule' && step === 'move_or_cancel' && flags.cancel_confirmed) return true;
  return false;
}

function getAllowedToolNames(lane, step, flags = {}, profileAllowedTools = null) {
  const laneMap = ALLOWLISTS[lane];
  if (!laneMap) return ['get_triage_session'];
  let names = [...(laneMap[step] || laneMap[Object.keys(laneMap)[0]] || ['get_triage_session'])];

  if (lane === 'reschedule' && step === 'move_or_cancel' && flags.cancel_pending) {
    names = names.filter((n) => n === 'search_appointments' || n === 'get_triage_session');
  }

  if (isGateOwnedTransactionalStep(lane, step, flags)) {
    names = names.filter((n) => !TRANSACTIONAL_GATE_TOOLS.has(n));
  }

  if (lane === 'records') {
    names = names.filter((n) => !PAYMENT_AND_SCHEDULE_TOOLS.has(n));
  }

  if (lane === 'education' && !flags.routine_intake_active) {
    names = names.filter((n) => !SKINCARE_ROUTINE_TOOLS.has(n));
  }

  if (Array.isArray(profileAllowedTools) && profileAllowedTools.length > 0) {
    const profileSet = new Set(profileAllowedTools);
    const ALWAYS_ALLOWED = new Set(['get_triage_session', 'end_call', 'transfer_call']);
    names = names.filter((n) => ALWAYS_ALLOWED.has(n) || profileSet.has(n));
    if (names.length === 0) names = ['get_triage_session'];
  }

  if (lane === 'clinical' && isOpqrstFieldGateEnabled()) {
    const gate = flags._opqrst_gate;
    if (gate?.allowStoreOpqrst || gate?.active) {
      if (!names.includes('store_triage_opqrst')) {
        names = [...names, 'store_triage_opqrst'];
      }
    }
  }

  return names;
}

module.exports = {
  ALLOWLISTS,
  SKINCARE_ROUTINE_TOOLS,
  PAYMENT_AND_SCHEDULE_TOOLS,
  TRANSACTIONAL_GATE_TOOLS,
  isGateOwnedTransactionalStep,
  getAllowedToolNames
};
