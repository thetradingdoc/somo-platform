'use strict';

/**
 * SSOT: which coding path a tenant visit uses (admin dental, admin clinic, preventive, full RAG).
 * See docs/Medical Coding/CODING_PATH_MATRIX.md
 */

const { TriagePolicy } = require('./conversation-mode/tenant-policy');
const { classifyPayerContext } = require('./payer-class-routing');
const deferralCopy = require('../../Knowledge/rules/coding-deferral-copy.json');

const CODING_PATH = Object.freeze({
  ADMIN_DENTAL: 'admin_dental',
  ADMIN_CLINIC: 'admin_clinic',
  PREVENTIVE: 'preventive',
  RAG: 'rag'
});

/** Symptom / clinical language → force full RAG when triage_policy is conditional. */
const CONDITIONAL_RAG_TRIGGERS = [
  /\bpain\b/i,
  /\brush\b/i,
  /\bfever\b/i,
  /\bcough\b/i,
  /\bnausea\b/i,
  /\bvomit/i,
  /\bbleeding\b/i,
  /\binfection\b/i,
  /\bswelling\b/i,
  /\bshortness of breath\b/i,
  /\bchest pain\b/i,
  /\bheadache\b/i,
  /\bsymptom/i,
  /\bdiagnos/i,
  /\btriage\b/i,
  /\bdermatology\b/i,
  /\bskin (?:problem|issue|concern)\b/i
];

const PREVENTIVE_TRIGGERS = [
  /\bannual\b/i,
  /\bwellness\b/i,
  /\bwell visit\b/i,
  /\bphysical exam\b/i,
  /\bpreventive\b/i,
  /\bno symptoms\b/i,
  /\bno active symptoms\b/i,
  /\broutine checkup\b/i
];

function isDentalUseCase(useCase, tenantSpecialty) {
  const uc = String(useCase || '').toLowerCase();
  const spec = String(tenantSpecialty || '').toLowerCase();
  return uc === 'dental' || spec === 'dental';
}

function isClinicAdminUseCase(useCase, tenantSpecialty) {
  const uc = String(useCase || '').toLowerCase();
  const spec = String(tenantSpecialty || '').trim().toLowerCase();
  if (isDentalUseCase(useCase, tenantSpecialty)) return false;
  return (
    uc === 'healthcare_clinic' ||
    uc === 'small_business' ||
    spec === 'healthcare_clinic' ||
    spec === 'primary care' ||
    spec === 'primarycare' ||
    spec === 'general practice'
  );
}

function matchesAny(text, patterns) {
  const t = String(text || '').trim();
  if (!t) return false;
  return patterns.some((re) => re.test(t));
}

function shouldForceRagForConditional(visitReason) {
  return matchesAny(visitReason, CONDITIONAL_RAG_TRIGGERS);
}

function isPreventiveVisitReason(visitReason) {
  return matchesAny(visitReason, PREVENTIVE_TRIGGERS);
}

function inferVisitMode(visitReason) {
  const t = String(visitReason || '');
  if (/\btelehealth\b|\bvideo visit\b|\bvirtual\b|\bvideo call\b/i.test(t)) return 'sync_video';
  return 'in_person';
}

/**
 * @param {object} opts
 * @param {string} [opts.useCase]
 * @param {string} [opts.triagePolicy] - required | conditional | disabled
 * @param {string} [opts.tenantSpecialty]
 * @param {string} [opts.visitReason]
 * @returns {{ path: string, useAdminPath: boolean, requiresTriageRag: boolean, reason: string }}
 */
function resolveVisitCodingPath(opts = {}) {
  const triagePolicy = opts.triagePolicy || opts.triage_policy || TriagePolicy.CONDITIONAL;
  const visitReason = opts.visitReason || opts.visit_reason || '';
  const useCase = opts.useCase || opts.use_case || '';
  const tenantSpecialty = opts.tenantSpecialty || opts.tenant_specialty || '';
  const visitMode = inferVisitMode(visitReason);

  if (triagePolicy === TriagePolicy.REQUIRED) {
    return {
      path: CODING_PATH.RAG,
      useAdminPath: false,
      requiresTriageRag: true,
      reason: 'triage_required',
      visitMode
    };
  }

  if (isPreventiveVisitReason(visitReason) && triagePolicy !== TriagePolicy.DISABLED) {
    return {
      path: CODING_PATH.PREVENTIVE,
      useAdminPath: false,
      requiresTriageRag: false,
      reason: 'preventive_visit',
      visitMode
    };
  }

  if (triagePolicy === TriagePolicy.CONDITIONAL && shouldForceRagForConditional(visitReason)) {
    return {
      path: CODING_PATH.RAG,
      useAdminPath: false,
      requiresTriageRag: true,
      reason: 'conditional_clinical_trigger',
      visitMode
    };
  }

  if (triagePolicy === TriagePolicy.DISABLED || triagePolicy === 'disabled') {
    if (isDentalUseCase(useCase, tenantSpecialty)) {
      return {
        path: CODING_PATH.ADMIN_DENTAL,
        useAdminPath: true,
        requiresTriageRag: false,
        reason: 'dental_admin_disabled_triage',
        visitMode
      };
    }
    if (isClinicAdminUseCase(useCase, tenantSpecialty)) {
      return {
        path: CODING_PATH.ADMIN_CLINIC,
        useAdminPath: true,
        requiresTriageRag: false,
        reason: 'clinic_admin_disabled_triage',
        visitMode
      };
    }
    return {
      path: CODING_PATH.ADMIN_CLINIC,
      useAdminPath: true,
      requiresTriageRag: false,
      reason: 'default_admin_disabled_triage',
      visitMode
    };
  }

  // conditional without clinical trigger — admin for dental/clinic front desk
  if (isDentalUseCase(useCase, tenantSpecialty)) {
    return {
      path: CODING_PATH.ADMIN_DENTAL,
      useAdminPath: true,
      requiresTriageRag: false,
      reason: 'dental_admin_conditional_no_trigger',
      visitMode
    };
  }

  return {
    path: CODING_PATH.RAG,
    useAdminPath: false,
    requiresTriageRag: true,
    reason: 'conditional_default_rag',
    visitMode
  };
}

/**
 * C-PR-02: Reject medical payer on dental tenant at collect time.
 * @returns {{ ok: boolean, error_code?: string, message?: string, message_key?: string }}
 */
function validatePayerClassForCollect({ payerId, planId, tenantSpecialty } = {}) {
  const ctx = classifyPayerContext({ payerId, planId, tenantSpecialty });
  if (ctx.ok) return { ok: true };
  return {
    ok: false,
    error_code: ctx.error_code || 'PAYER_CLASS_MISMATCH',
    message_key: ctx.message_key || 'PAYER_CLASS_MISMATCH',
    message: deferralCopy.PAYER_CLASS_MISMATCH || deferralCopy.PAYER_NOT_SEEDED
  };
}

module.exports = {
  CODING_PATH,
  CONDITIONAL_RAG_TRIGGERS,
  PREVENTIVE_TRIGGERS,
  resolveVisitCodingPath,
  validatePayerClassForCollect,
  inferVisitMode,
  shouldForceRagForConditional,
  isPreventiveVisitReason,
  isDentalUseCase,
  isClinicAdminUseCase
};
