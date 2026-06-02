'use strict';

/** Tool names allowed per lane step (tool-first rails). */

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
    triage_assessment: ['run_triage_rag', 'get_triage_session', 'store_triage_opqrst']
  },
  booking: {
    schedule_visit: ['get_available_slots', 'get_triage_session'],
    confirm_visit: ['schedule_appointment', 'create_appointment_checkout', 'get_triage_session']
  },
  payment: {
    pay_invoice: ['request_patient_payment', 'collect_insurance', 'get_patient_claims'],
    insurance: ['collect_insurance', 'get_patient_claims'],
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

function getAllowedToolNames(lane, step) {
  const laneMap = ALLOWLISTS[lane];
  if (!laneMap) return ['get_triage_session'];
  return laneMap[step] || laneMap[Object.keys(laneMap)[0]] || ['get_triage_session'];
}

module.exports = { ALLOWLISTS, getAllowedToolNames };
