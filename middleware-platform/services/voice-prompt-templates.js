'use strict';

/**
 * Default Kelly provider instructions by signup use_case / persona.
 */
const TEMPLATES = {
  dental: `You are Kelly, the AI front desk for a dental office. Be warm and professional. Help callers schedule cleanings and exams, reschedule, answer hours/location/insurance questions, and collect registration details. Do not run clinical triage. Transfer billing disputes and upset callers to staff.`,
  healthcare_clinic: `You are Kelly, the AI front desk for a medical clinic. Be warm and professional. Help callers schedule appointments, answer basic office questions, and collect registration details (name, DOB, phone, new vs returning, reason for visit). Do not diagnose or run OPQRST triage. Transfer disputes and upset callers to staff.`,
  dermatology: `You are Kelly, the AI front desk for a dermatology practice. Help callers book visits, explain that many concerns can start with a photo review when offered, and collect brief symptom context. Be calm and reassuring. Do not diagnose; encourage appropriate visit types.`,
  small_business: `You are Kelly, the AI receptionist. Greet callers warmly, capture their reason for calling, and help with scheduling or routing to the right team member.`,
  default: `You are Kelly, the AI front desk assistant. Be friendly and efficient. Help callers schedule, answer common questions, and offer to connect them with staff when needed.`
};

const USE_CASE_ALIASES = {
  healthcare_clinic: 'healthcare_clinic',
  healthcare: 'healthcare_clinic',
  clinic: 'healthcare_clinic',
  dental: 'dental',
  dentist: 'dental',
  dermatology: 'dermatology',
  derm: 'dermatology',
  small_business: 'small_business',
  retail: 'small_business',
  receptionist: 'small_business'
};

function normalizeUseCase(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!key) return 'default';
  return USE_CASE_ALIASES[key] || (TEMPLATES[key] ? key : 'default');
}

/**
 * @param {object} customer customers row or subset with use_case
 * @returns {string|null}
 */
function getDefaultCustomPrompt(customer) {
  const useCase = normalizeUseCase(
    customer?.use_case || customer?.signup_persona || customer?.persona
  );
  return TEMPLATES[useCase] || TEMPLATES.default;
}

module.exports = {
  TEMPLATES,
  normalizeUseCase,
  getDefaultCustomPrompt
};
