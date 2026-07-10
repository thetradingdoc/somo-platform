'use strict';

/**
 * Dermatology clinical PSTN scenario registry (Phase 7.3).
 * Live PSTN execution requires real tenant DID — see docs/qa/pstn-vertical-matrix.md.
 */

const DERMATOLOGY_PSTN_SCENARIOS = [
  {
    id: 'DERM-001',
    title: 'OPQRST intake — rash concern',
    use_case: 'dermatology',
    locale: 'en-US',
    intent: 'clinical',
    utterances: [
      'I have a red itchy rash on my arm that started three days ago.',
      'It gets worse when I scratch it. About a six out of ten for pain.'
    ],
    expectedTools: ['store_triage_opqrst', 'run_triage_rag'],
    assertions: ['OPQRST_INTAKE', 'RAG_DIFFERENTIAL'],
    live_only: true
  },
  {
    id: 'DERM-002',
    title: 'Low-confidence → HITL routing',
    use_case: 'dermatology',
    locale: 'en-US',
    intent: 'clinical',
    utterances: [
      'I have a changing mole and I am worried about skin cancer.',
      'Yes, please have a clinician review this.'
    ],
    expectedTools: ['run_triage_rag'],
    assertions: ['HITL_QUEUE', 'NO_PHI_LEAK'],
    live_only: true
  },
  {
    id: 'DERM-003',
    title: 'Spanish OPQRST pack',
    use_case: 'dermatology',
    locale: 'es-US',
    language_mode: 'en_es',
    intent: 'clinical',
    utterances: ['Tengo una erupción en el brazo desde hace dos días.', 'Pica mucho por la noche.'],
    expectedTools: ['store_triage_opqrst'],
    assertions: ['BILINGUAL_OPQRST'],
    live_only: true
  },
  {
    id: 'DERM-004',
    title: 'Booking after triage handoff',
    use_case: 'dermatology',
    locale: 'en-US',
    intent: 'booking',
    utterances: ['I need to schedule a dermatology visit for a skin check.'],
    expectedTools: ['schedule_appointment'],
    assertions: ['BOOKING_OFFER'],
    live_only: true
  }
];

module.exports = { DERMATOLOGY_PSTN_SCENARIOS };
