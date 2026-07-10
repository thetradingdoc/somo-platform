'use strict';

/**
 * healthcare_clinic admin-path PSTN scenarios (Phase 7.3).
 */

const HEALTHCARE_CLINIC_PSTN_SCENARIOS = [
  {
    id: 'HC-001',
    title: 'New patient — general consult',
    use_case: 'healthcare_clinic',
    locale: 'en-US',
    intent: 'booking',
    utterances: ['I am a new patient and need a general checkup.', 'Next Tuesday morning works.'],
    expectedTools: ['schedule_appointment'],
    assertions: ['BOOKING_OFFER', 'ADMIN_CODE_PATH'],
    live_only: true
  },
  {
    id: 'HC-002',
    title: 'Cancel appointment',
    use_case: 'healthcare_clinic',
    locale: 'en-US',
    intent: 'cancel',
    utterances: ['I need to cancel my appointment tomorrow.', 'Yes, please cancel it.'],
    expectedTools: ['cancel_appointment'],
    assertions: ['CANCEL_CONFIRMED'],
    live_only: true
  },
  {
    id: 'HC-003',
    title: 'Reschedule appointment',
    use_case: 'healthcare_clinic',
    locale: 'en-US',
    intent: 'reschedule',
    utterances: ['Can I move my visit to Friday afternoon?'],
    expectedTools: ['reschedule_appointment'],
    assertions: ['RESCHEDULE_OFFER'],
    live_only: true
  },
  {
    id: 'HC-004',
    title: 'Copay quote — admin code',
    use_case: 'healthcare_clinic',
    locale: 'en-US',
    intent: 'copay',
    utterances: ['What is my copay for a routine visit? I have Aetna.'],
    expectedTools: ['collect_insurance'],
    assertions: ['COPAY_QUOTE', 'ADMIN_CODE_PATH'],
    live_only: true
  },
  {
    id: 'HC-005',
    title: 'Records Q&A — admin path',
    use_case: 'healthcare_clinic',
    locale: 'en-US',
    intent: 'records',
    utterances: ['Can you tell me when my last visit was?'],
    expectedTools: ['query_patient_records'],
    assertions: ['RECORDS_RESPONSE'],
    live_only: true
  }
];

module.exports = { HEALTHCARE_CLINIC_PSTN_SCENARIOS };
