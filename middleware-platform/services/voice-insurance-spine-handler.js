'use strict';

/**
 * Shared resolveInsuranceCodes + HTTP status mapping for voice insurance routes.
 */

function resolveInsuranceSpineForRequest(sessionId, args, opts = {}) {
  const { resolveInsuranceCodes } = require('./resolve-insurance-codes');
  const codingReviewSvc = require('./coding-review-service');
  const { loadTenantPolicyFromProfile, TriagePolicy } = require('./conversation-mode/tenant-policy');
  const db = require('../database');

  let triagePolicy = opts.triage_policy || args.triage_policy || null;
  let tenantSpecialty = opts.tenantSpecialty || args.tenant_specialty || args.specialty || null;
  if (!triagePolicy && (args.clinic_id || opts.clinicId)) {
    try {
      const policy = loadTenantPolicyFromProfile(db, args.clinic_id || opts.clinicId, args.customer_id || null);
      triagePolicy = policy.triage_policy;
    } catch (_) {}
  }

  const visitReason =
    args.visit_reason ||
    args.visitReason ||
    args.reason_for_visit ||
    opts.visit_reason ||
    null;

  const spineResolved = resolveInsuranceCodes(sessionId, {
    service_code: args.service_code,
    adminOverride: opts.adminOverride === true,
    force_after_clarified: args.force_after_clarified === true || args.force_after_clarified === 'true',
    clinicId: args.clinic_id || null,
    patientId: args.patient_id || args.patientId || null,
    flagHitl: (p) => codingReviewSvc.flagForReview(p),
    triage_policy: triagePolicy,
    visit_reason: visitReason,
    tenantSpecialty: tenantSpecialty || (triagePolicy === TriagePolicy.DISABLED ? 'Dental' : null),
    useAdminPath: opts.useAdminPath === true || args.use_admin_path === true
  });

  const preResolved =
    args.primary_cpt && args.primary_icd10 && args.code_source && !args.service_code;
  console.log(
    '[coding_resolve] layer=http_spine phase=collect_route authoritative=%s session_id=%s primary_cpt=%s',
    preResolved ? 'false (kelly pre-resolved)' : 'true',
    sessionId,
    spineResolved.ok ? spineResolved.primary_cpt : '(blocked)'
  );

  if (spineResolved.ok) {
    return { ok: true, spineResolved };
  }

  if (spineResolved.status === 'CODING_REVIEW_REQUIRED') {
    return {
      ok: false,
      httpStatus: 202,
      body: {
        success: false,
        status: 'CODING_REVIEW_REQUIRED',
        error_code: spineResolved.error_code,
        message: spineResolved.message
      }
    };
  }

  if (spineResolved.error_code === 'CLIENT_SERVICE_CODE_REJECTED') {
    return {
      ok: false,
      httpStatus: 400,
      body: {
        success: false,
        error_code: spineResolved.error_code,
        message: spineResolved.message
      }
    };
  }

  return {
    ok: false,
    httpStatus: 403,
    body: {
      success: false,
      error_code: spineResolved.error_code || spineResolved.status,
      message: spineResolved.message,
      invalid_codes: spineResolved.invalid_codes
    }
  };
}

function applySpineResolvedToArgs(args, spineResolved) {
  args.primary_icd10 = spineResolved.primary_icd10;
  args.primary_cpt = spineResolved.primary_cpt;
  args.service_code = spineResolved.primary_cpt;
  args.code_source = spineResolved.code_source;
  return args;
}

module.exports = {
  resolveInsuranceSpineForRequest,
  applySpineResolvedToArgs
};
