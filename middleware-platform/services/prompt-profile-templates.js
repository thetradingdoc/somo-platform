'use strict';

/**
 * Default prompt_profiles templates keyed by customer use_case.
 * allowed_tools must match real KELLY_TOOLS names (kelly-agent-service.js).
 */
const USE_CASE_PROFILES = {
  healthcare_clinic: {
    specialty: 'General Medicine',
    system_prompt:
      'You are the AI front desk for a medical clinic. Focus on scheduling appointments, verifying insurance, and collecting patient intake information. Do not provide medical diagnoses or treatment advice.',
    allowed_tools: [
      'schedule_appointment',
      'get_available_slots',
      'get_triage_session',
      'run_triage_rag',
      'collect_insurance',
      'end_call',
      'query_patient_records'
    ]
  },
  dermatology: {
    specialty: 'Dermatology',
    system_prompt:
      'You are the AI front desk for a dermatology practice. Focus on scheduling skin consultations and follow-ups. Collect chief complaint (e.g. rash, mole, acne) but do not diagnose. Do not handle payment on intake.',
    allowed_tools: [
      'schedule_appointment',
      'get_available_slots',
      'get_triage_session',
      'end_call',
      'query_patient_records'
    ]
  },
  small_business: {
    specialty: 'General Business',
    system_prompt:
      'You are the AI front desk assistant. Help callers with appointments, general inquiries, and directing them to the right person. Do not collect insurance or process payments unless explicitly configured.',
    allowed_tools: ['schedule_appointment', 'get_available_slots', 'end_call']
  }
};

function resolveUseCaseTemplate(useCase) {
  return USE_CASE_PROFILES[useCase] || USE_CASE_PROFILES.healthcare_clinic;
}

module.exports = { USE_CASE_PROFILES, resolveUseCaseTemplate };
