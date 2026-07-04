'use strict';

/**
 * Default prompt_profiles templates keyed by customer use_case.
 * allowed_tools must match real KELLY_TOOLS names (kelly-agent-service.js).
 */
const { USE_CASE_POLICIES } = require('./conversation-mode/tenant-policy');

const USE_CASE_PROFILES = {
  dental: {
    specialty: 'Dental',
    system_prompt:
      'You are the AI front desk for a dental office. Help callers schedule hygiene and exam visits, reschedule, confirm hours and location, answer insurance and copay questions, and register new patients. Collect name, date of birth, phone, new vs returning, and reason for visit. Do not perform clinical triage or OPQRST. Escalate billing disputes and upset callers to staff.',
    allowed_tools: [
      'schedule_appointment',
      'get_available_slots',
      'collect_insurance',
      'compute_visit_quote',
      'end_call',
      'transfer_call',
      'query_patient_records',
      'request_patient_payment',
      'cancel_appointment',
      'search_appointments',
      'reschedule_appointment'
    ],
    policy: USE_CASE_POLICIES.dental
  },
  healthcare_clinic: {
    specialty: 'General Medicine',
    system_prompt:
      'You are the AI front desk for a medical clinic. Help with new patient registration, rescheduling, insurance verification questions, copay collection, office hours, and location. Collect name, DOB, phone, new vs returning, and administrative reason for visit. Do not run clinical triage or OPQRST. Offer warm transfer for billing disputes or upset callers.',
    allowed_tools: [
      'schedule_appointment',
      'get_available_slots',
      'collect_insurance',
      'end_call',
      'transfer_call',
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
  const key = useCase === 'dental_office' ? 'dental' : useCase;
  return USE_CASE_PROFILES[key] || USE_CASE_PROFILES.healthcare_clinic;
}

/** Map dental_office alias to dental profile (AO-P0-1). */
USE_CASE_PROFILES.dental_office = USE_CASE_PROFILES.dental;

/** Map signup medical_specialty to prompt_profile use_case key. */
function resolveSpecialtyToUseCase(medicalSpecialty, fallbackUseCase = 'healthcare_clinic') {
  const raw = String(medicalSpecialty || '').trim().toLowerCase();
  if (!raw) return fallbackUseCase;
  if (/derm|skin|rash|mole/.test(raw)) return 'dermatology';
  if (/mental|psych|therapy|counsel/.test(raw)) return 'healthcare_clinic';
  if (/dental|dentist|orthodont/.test(raw)) return 'dental';
  if (raw === 'dental_office') return 'dental_office';
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
  const normalizedUseCase = useCase === 'dental_office' ? 'dental' : useCase;
  const basePolicy = USE_CASE_POLICIES[normalizedUseCase] || USE_CASE_POLICIES.healthcare_clinic;
  return { ...USE_CASE_POLICIES.healthcare_clinic, ...basePolicy, ...policy };
}

module.exports = {
  USE_CASE_PROFILES,
  resolveUseCaseTemplate,
  resolveSpecialtyToUseCase,
  getEffectiveTenantPolicy
};
