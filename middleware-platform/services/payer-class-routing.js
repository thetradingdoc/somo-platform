'use strict';

/**
 * C-PR: Medical vs dental payer/plan routing for copay spine.
 */

const MEDICAL_PAYER_HINTS = /\b(medicare|medicaid|bcbs|blue cross|aetna medical|cigna medical|united healthcare|uhc|humana medical)\b/i;
const DENTAL_PAYER_HINTS = /\b(dental|delta dental|metlife dental|guardian dental|denta|ddpa|dental ppo)\b/i;
const MEDICAL_PAYER_ID_PREFIX = /^(BCBS|AETNA|CIGNA|UHC|UNITED|MEDICARE|MEDICAID|HUMANA)_/i;

function classifyPayerContext({ payerId, planId, tenantSpecialty } = {}) {
  const specialty = String(tenantSpecialty || '').toLowerCase();
  const payer = String(payerId || '').toUpperCase();
  const plan = String(planId || '').toLowerCase();
  const combined = `${payer} ${plan}`;

  const isDentalTenant =
    specialty === 'dental' || specialty.includes('dental') || specialty === 'small_business';

  if (!isDentalTenant) {
    return { ok: true, payer_class: 'medical', tenant: specialty || 'medical' };
  }

  if (DENTAL_PAYER_HINTS.test(combined) || /_DENTAL|DENTAL_/.test(payer)) {
    return { ok: true, payer_class: 'dental', tenant: 'dental' };
  }

  const medicalHint =
    MEDICAL_PAYER_HINTS.test(combined) ||
    MEDICAL_PAYER_ID_PREFIX.test(payer) ||
    /\bBCBS\b/.test(payer);

  if (medicalHint && !DENTAL_PAYER_HINTS.test(combined)) {
    return {
      ok: false,
      payer_class: 'medical_on_dental_tenant',
      error_code: 'PAYER_CLASS_MISMATCH',
      message_key: 'PAYER_CLASS_MISMATCH'
    };
  }

  return { ok: true, payer_class: 'dental_or_unknown', tenant: 'dental' };
}

module.exports = { classifyPayerContext, MEDICAL_PAYER_HINTS, DENTAL_PAYER_HINTS, MEDICAL_PAYER_ID_PREFIX };
