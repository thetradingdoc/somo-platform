'use strict';

const { InconclusiveTriageAction } = require('./opqrst-exit-states');

/** Triage policy levels. */
const TriagePolicy = Object.freeze({
  REQUIRED: 'required',
  CONDITIONAL: 'conditional',
  DISABLED: 'disabled'
});

const BookingMode = Object.freeze({
  ADMIN_DIRECT: 'admin_direct',
  CLINICAL_AFTER_TRIAGE: 'clinical_after_triage'
});

const DEFAULT_TENANT_POLICY = Object.freeze({
  triage_policy: TriagePolicy.CONDITIONAL,
  booking_mode: BookingMode.ADMIN_DIRECT,
  billing_enabled: true,
  records_enabled: true,
  inconclusive_triage_action: InconclusiveTriageAction.BOOK_GENERAL
});

/** Policy defaults by customer use_case. */
const USE_CASE_POLICIES = {
  healthcare_clinic: {
    triage_policy: TriagePolicy.CONDITIONAL,
    booking_mode: BookingMode.ADMIN_DIRECT,
    billing_enabled: true,
    records_enabled: true,
    inconclusive_triage_action: InconclusiveTriageAction.BOOK_GENERAL
  },
  dermatology: {
    triage_policy: TriagePolicy.REQUIRED,
    booking_mode: BookingMode.CLINICAL_AFTER_TRIAGE,
    billing_enabled: true,
    records_enabled: true,
    inconclusive_triage_action: InconclusiveTriageAction.NURSE_CALLBACK
  },
  small_business: {
    triage_policy: TriagePolicy.DISABLED,
    booking_mode: BookingMode.ADMIN_DIRECT,
    billing_enabled: false,
    records_enabled: false,
    inconclusive_triage_action: InconclusiveTriageAction.HANDOFF
  }
};

function parsePolicyJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function resolveTenantPolicy(input = {}) {
  const useCase = input.use_case || input.useCase || 'healthcare_clinic';
  const base = { ...DEFAULT_TENANT_POLICY, ...(USE_CASE_POLICIES[useCase] || USE_CASE_POLICIES.healthcare_clinic) };
  const profile = parsePolicyJson(input.policy_json || input.tenant_policy);
  const merged = { ...base, ...profile };
  if (!Object.values(TriagePolicy).includes(merged.triage_policy)) {
    merged.triage_policy = TriagePolicy.CONDITIONAL;
  }
  if (!Object.values(InconclusiveTriageAction).includes(merged.inconclusive_triage_action)) {
    merged.inconclusive_triage_action = InconclusiveTriageAction.BOOK_GENERAL;
  }
  return merged;
}

function loadTenantPolicyFromProfile(db, clinicId, customerId) {
  if (!db?.getClinicPromptProfile) return { ...DEFAULT_TENANT_POLICY };
  try {
    const profile = db.getClinicPromptProfile(clinicId, customerId);
    if (!profile) return { ...DEFAULT_TENANT_POLICY };
    let policyJson = {};
    if (profile.policy_json) {
      policyJson = parsePolicyJson(profile.policy_json);
    }
    const useCase = profile.use_case || profile.specialty?.toLowerCase()?.includes('derm')
      ? 'dermatology'
      : 'healthcare_clinic';
    return resolveTenantPolicy({ use_case: useCase, tenant_policy: policyJson });
  } catch (_) {
    return { ...DEFAULT_TENANT_POLICY };
  }
}

function canPivotToBilling(policy) {
  return policy?.billing_enabled !== false;
}

function canPivotToRecords(policy) {
  return policy?.records_enabled !== false;
}

function canPivotToClinical(policy) {
  return policy?.triage_policy !== TriagePolicy.DISABLED;
}

function bookingAllowedWithoutOpqrst(policy, mode) {
  if (mode === 'tenant_inbound_admin') {
    return policy.triage_policy === TriagePolicy.DISABLED || policy.triage_policy === TriagePolicy.CONDITIONAL;
  }
  return false;
}

module.exports = {
  TriagePolicy,
  BookingMode,
  DEFAULT_TENANT_POLICY,
  USE_CASE_POLICIES,
  resolveTenantPolicy,
  loadTenantPolicyFromProfile,
  canPivotToBilling,
  canPivotToRecords,
  canPivotToClinical,
  bookingAllowedWithoutOpqrst,
  parsePolicyJson
};
