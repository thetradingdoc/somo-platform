'use strict';

/**
 * Default prompt_profiles templates keyed by customer use_case.
 * system_prompt literals come from voice-prompt-templates (single canonical source).
 */
const { USE_CASE_POLICIES } = require('./conversation-mode/tenant-policy');
const { TEMPLATES } = require('./voice-prompt-templates');
const { PROFILE_ALLOWED_TOOLS } = require('./kelly-rails/tool-allowlists');

const USE_CASE_PROFILES = {
  dental: {
    specialty: 'Dental',
    system_prompt: TEMPLATES.dental,
    allowed_tools: PROFILE_ALLOWED_TOOLS.dental,
    policy: USE_CASE_POLICIES.dental
  },
  healthcare_clinic: {
    specialty: 'General Medicine',
    system_prompt: TEMPLATES.healthcare_clinic,
    allowed_tools: PROFILE_ALLOWED_TOOLS.healthcare_clinic,
    policy: USE_CASE_POLICIES.healthcare_clinic
  },
  dermatology: {
    specialty: 'Dermatology',
    system_prompt: TEMPLATES.dermatology,
    allowed_tools: PROFILE_ALLOWED_TOOLS.dermatology,
    policy: USE_CASE_POLICIES.dermatology
  },
  small_business: {
    specialty: 'General Business',
    system_prompt: TEMPLATES.small_business,
    allowed_tools: PROFILE_ALLOWED_TOOLS.small_business,
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
  if (profile.policy_json) {
    try {
      const fromJson =
        typeof profile.policy_json === 'string' ? JSON.parse(profile.policy_json) : profile.policy_json;
      policy = { ...policy, ...(fromJson || {}) };
    } catch (_) {}
  }
  const useCase = profile.use_case || 'healthcare_clinic';
  const normalizedUseCase = useCase === 'dental_office' ? 'dental' : useCase;
  const basePolicy = USE_CASE_POLICIES[normalizedUseCase] || USE_CASE_POLICIES.healthcare_clinic;
  return { ...basePolicy, ...policy };
}

module.exports = {
  USE_CASE_PROFILES,
  resolveUseCaseTemplate,
  resolveSpecialtyToUseCase,
  getEffectiveTenantPolicy
};
