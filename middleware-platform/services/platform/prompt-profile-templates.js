'use strict';

/**
 * Default prompt_profiles templates keyed by customer use_case.
 * allowed_tools must match real KELLY_TOOLS names (kelly-agent-service.js).
 */
const { USE_CASE_POLICIES } = require('../conversation/tenant-policy');

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
      'query_patient_records',
      'request_patient_payment'
    ],
    policy: USE_CASE_POLICIES.healthcare_clinic
  },
  dermatology: {
    specialty: 'Dermatology',
    system_prompt:
      'You are the AI front desk for a dermatology practice. Focus on scheduling skin consultations and follow-ups. Collect chief complaint (e.g. rash, mole, acne) but do not diagnose. Do not handle payment on intake.',
    allowed_tools: [
      'schedule_appointment',
      'get_available_slots',
      'get_triage_session',
      'store_triage_opqrst',
      'end_call',
      'query_patient_records',
      'request_patient_payment'
    ],
    policy: USE_CASE_POLICIES.dermatology
  },
  small_business: {
    specialty: 'General Business',
    system_prompt:
      'You are the AI front desk assistant. Help callers with appointments, general inquiries, and directing them to the right person. Do not collect insurance or process payments unless explicitly configured.',
    allowed_tools: ['schedule_appointment', 'get_available_slots', 'end_call'],
    policy: USE_CASE_POLICIES.small_business
  }
};

function resolveUseCaseTemplate(useCase) {
  return USE_CASE_PROFILES[useCase] || USE_CASE_PROFILES.healthcare_clinic;
}

/** Map signup medical_specialty to prompt_profile use_case key. */
function resolveSpecialtyToUseCase(medicalSpecialty, fallbackUseCase = 'healthcare_clinic') {
  const raw = String(medicalSpecialty || '').trim().toLowerCase();
  if (!raw) return fallbackUseCase;
  if (/derm|skin|rash|mole/.test(raw)) return 'dermatology';
  if (/mental|psych|therapy|counsel/.test(raw)) return 'healthcare_clinic';
  if (/dental|dentist|orthodont/.test(raw)) return 'healthcare_clinic';
  if (USE_CASE_PROFILES[raw.replace(/\s+/g, '_')]) return raw.replace(/\s+/g, '_');
  return fallbackUseCase;
}

function getEffectiveTenantPolicy(profile) {
  if (!profile) return USE_CASE_POLICIES.healthcare_clinic;
  let policy = {};
  if (profile.metadata) {
    try {
      const meta = typeof profile.metadata === 'string' ? JSON.parse(profile.metadata) : profile.metadata;
      policy = meta.tenant_policy || meta.policy || {};
    } catch (_) {}
  }
  const useCase = profile.use_case || 'healthcare_clinic';
  return { ...USE_CASE_POLICIES[useCase], ...USE_CASE_POLICIES.healthcare_clinic, ...policy };
}

module.exports = {
  USE_CASE_PROFILES,
  resolveUseCaseTemplate,
  resolveSpecialtyToUseCase,
  getEffectiveTenantPolicy
};
