'use strict';

const HEALTHCARE_USE_CASES = new Set(['dental', 'dental_office', 'healthcare_clinic']);

function isHealthcareVoiceTenant(customer) {
  if (!customer) return false;
  if (customer.billing_vertical === 'healthcare') return true;
  const useCase = String(customer.use_case || '').toLowerCase();
  return HEALTHCARE_USE_CASES.has(useCase);
}

/**
 * Fail-closed when required Retell dynamic variables are missing for healthcare tenants.
 * @returns {{ ok: boolean, missing?: string[] }}
 */
function validateHealthcareVoiceVars({ customer, customerId, clinicId, callType }) {
  if (!isHealthcareVoiceTenant(customer)) {
    return { ok: true };
  }
  const missing = [];
  if (!customerId) missing.push('customer_id');
  if (!clinicId) missing.push('clinic_id');
  if (!callType) missing.push('call_type');
  return { ok: missing.length === 0, missing };
}

module.exports = {
  HEALTHCARE_USE_CASES,
  isHealthcareVoiceTenant,
  validateHealthcareVoiceVars
};
