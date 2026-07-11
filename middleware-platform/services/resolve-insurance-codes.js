'use strict';

/**
 * Shared insurance coding spine resolver (Kelly executor + voice HTTP).
 */

const TriageRAGService = require('./triage-rag-service');
const knowledgeService = require('./knowledge-service');
const db = require('../database');
const { resolveCptForVisit, isDentalCdt } = require('../utils/cpt-helper');
const { resolveAdminInsuranceCodes } = require('./resolve-admin-visit-codes');
const { CODING_CONFIDENCE_THRESHOLD, isConfidenceNearThreshold } = require('../config/coding-thresholds');
const { TriagePolicy } = require('./conversation-mode/tenant-policy');
const { resolveVisitCodingPath } = require('./resolve-visit-codes');
const { selectPrimaryProcedure } = require('./select-primary-codes');
const { persistCodingProvenanceRow, logCodingProvenanceEvent } = require('./coding-provenance-store');

function attachModifiers(primaryIcd10, serviceCode, extraCpt = []) {
  const cptList = [serviceCode, ...extraCpt].filter(Boolean).map((code) => ({ code }));
  const required = knowledgeService.getRequiredModifiers(cptList);
  const suggested = required.get(serviceCode) || [];
  return suggested.length ? suggested : undefined;
}

function finalizeResolved(sessionId, resolved, routing, opts = {}) {
  const visitMode = routing?.visitMode || opts.visit_mode || null;
  const modifiers = resolved.primary_cpt
    ? attachModifiers(resolved.primary_icd10, resolved.primary_cpt, opts.secondary_cpt || [])
    : undefined;

  if (sessionId && resolved.coding_provenance) {
    persistCodingProvenanceRow(sessionId, {
      ...resolved.coding_provenance,
      visit_mode: visitMode,
      suggested_modifiers: modifiers
    }, {
      targetSpecialty: resolved.target_specialty,
      channel: resolved.admin_path ? 'admin' : 'rag'
    });
    logCodingProvenanceEvent(sessionId, {
      code_source: resolved.code_source,
      primary_icd10: resolved.primary_icd10,
      primary_cpt: resolved.primary_cpt,
      visit_mode: visitMode,
      admin_path: !!resolved.admin_path
    }, { clinicId: opts.clinicId });
  }

  return {
    ...resolved,
    visit_mode: visitMode,
    suggested_modifiers: modifiers,
    coding_path: routing?.path || resolved.coding_path,
    routing_reason: routing?.reason || resolved.routing_reason
  };
}

function resolveInsuranceCodesCore(sessionId, opts = {}) {
  const {
    service_code: clientServiceCode = null,
    adminOverride = false,
    force_after_clarified: forceAfterClarified = false,
    clinicId = null,
    patientId = null,
    flagHitl = null,
    triage_policy: triagePolicy = null,
    visit_reason: visitReason = null,
    tenantSpecialty = null,
    useAdminPath = false,
    use_case: useCase = null
  } = opts;

  const routing = resolveVisitCodingPath({
    triagePolicy,
    visitReason,
    tenantSpecialty,
    useCase
  });

  const adminPath =
    useAdminPath === true ||
    routing.useAdminPath ||
    triagePolicy === TriagePolicy.DISABLED ||
    String(triagePolicy || '').toLowerCase() === 'disabled';

  if (adminPath) {
    const harnessRow = sessionId && db.db
      ? db.db.prepare(
          `SELECT seeded_for_harness FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
        ).get(sessionId)
      : null;
    if (harnessRow?.seeded_for_harness === 1) {
      return {
        ok: false,
        status: 'CODING_REVIEW_REQUIRED',
        error_code: 'CODING_REVIEW_REQUIRED',
        message: 'Harness-seeded triage requires clinical review before insurance verification.'
      };
    }

    const adminResult = resolveAdminInsuranceCodes({
      visit_reason: visitReason,
      visitReasonText: visitReason,
      tenantSpecialty: tenantSpecialty || 'Dental',
      isNewPatient: opts.isNewPatient !== false,
      patient_age: opts.patient_age
    });
    if (adminResult.ok) {
      return finalizeResolved(sessionId, { ...adminResult, admin_path: true }, routing, opts);
    }
    return adminResult;
  }

  if (clientServiceCode && !adminOverride) {
    return {
      ok: false,
      status: 'REJECTED_CLIENT_CODE',
      error_code: 'CLIENT_SERVICE_CODE_REJECTED',
      message: 'Client-supplied service_code is not accepted. Codes must come from the triage spine.'
    };
  }

  const triageResult = TriageRAGService.getAuthoritativeForSession(sessionId);
  if (!triageResult) {
    return {
      ok: false,
      status: 'TRIAGE_REQUIRED',
      error_code: 'TRIAGE_REQUIRED',
      message: 'Complete triage first with run_triage_rag before verifying insurance.'
    };
  }

  if (triageResult.seeded_for_harness === 1 || triageResult.seeded_for_harness === true) {
    if (flagHitl) {
      flagHitl({
        sessionId,
        clinicId,
        patientId,
        proposed_icd10: triageResult.primary_icd10 || '',
        proposed_cpt: triageResult.primary_cpt || '',
        confidence: triageResult.rag_confidence ?? 0,
        reason: 'harness_seeded_triage'
      });
    }
    return {
      ok: false,
      status: 'CODING_REVIEW_REQUIRED',
      error_code: 'CODING_REVIEW_REQUIRED',
      message: 'Harness-seeded triage requires clinical review before insurance verification.'
    };
  }

  const confidence = triageResult.rag_confidence != null && triageResult.rag_confidence !== ''
    ? parseFloat(triageResult.rag_confidence)
    : 0;
  const threshold = opts.confidenceThreshold ?? CODING_CONFIDENCE_THRESHOLD;
  const allowBorderline = forceAfterClarified && isConfidenceNearThreshold(confidence, threshold);

  if (confidence < threshold && !allowBorderline) {
    if (flagHitl) {
      flagHitl({
        sessionId,
        clinicId,
        patientId,
        proposed_icd10: triageResult.primary_icd10 || '',
        proposed_cpt: triageResult.primary_cpt || '',
        confidence,
        reason: 'low_confidence'
      });
    }
    return {
      ok: false,
      status: 'CODING_REVIEW_REQUIRED',
      error_code: 'CODING_REVIEW_REQUIRED',
      message: 'RAG confidence is low. A clinical reviewer must confirm codes before insurance verification.'
    };
  }

  const primaryIcd10 = String(triageResult.primary_icd10 || '').trim();
  if (!primaryIcd10) {
    return {
      ok: false,
      status: 'MISSING_CODES',
      error_code: 'MISSING_CODES',
      message: 'We need a confirmed diagnosis code from triage before we can verify insurance.'
    };
  }

  let spineCpt = triageResult.primary_cpt || null;
  if (!spineCpt && (triageResult.cpt_codes?.length || triageResult.hcpcs_codes?.length)) {
    const pick = selectPrimaryProcedure({
      cptCandidates: triageResult.cpt_codes || [],
      hcpcsCandidates: triageResult.hcpcs_codes || [],
      primaryIcd10: triageResult.primary_icd10,
      telehealthIntent: Boolean(opts.telehealthIntent)
    });
    spineCpt = pick.code_type === 'cpt' ? pick.code : spineCpt;
  }

  const cptResolution = resolveCptForVisit({
    spineCpt,
    confidence,
    specialty: triageResult.target_specialty || 'PrimaryCare',
    isNewPatient: opts.isNewPatient !== false,
    urgency: triageResult.urgency || 'routine',
    confidenceThreshold: threshold
  });

  const serviceCode = adminOverride && clientServiceCode
    ? clientServiceCode
    : cptResolution.code;

  if (!serviceCode || cptResolution.code_source === 'hitl_required') {
    if (flagHitl) {
      flagHitl({
        sessionId,
        clinicId,
        patientId,
        proposed_icd10: primaryIcd10,
        proposed_cpt: triageResult.primary_cpt || '',
        confidence,
        reason: cptResolution.fallback_reason || 'missing_spine_cpt'
      });
    }
    return {
      ok: false,
      status: 'CODING_REVIEW_REQUIRED',
      error_code: 'CODING_REVIEW_REQUIRED',
      message: 'We need a reviewer to confirm procedure codes before we can verify insurance.'
    };
  }

  const codeValidation = knowledgeService.validateCodesExist(
    { icd10: [primaryIcd10], cpt: [serviceCode] },
    isDentalCdt(serviceCode) ? { trustFormattedCodes: true } : {}
  );
  if (!codeValidation.valid) {
    return {
      ok: false,
      status: 'INVALID_CODES',
      error_code: 'INVALID_CODES',
      message: 'The diagnosis or procedure codes from triage could not be verified.',
      invalid_codes: codeValidation.invalid
    };
  }

  const pairCheck = knowledgeService.validateCodePair(primaryIcd10, serviceCode);
  if (!pairCheck.valid) {
    if (flagHitl) {
      flagHitl({
        sessionId,
        clinicId,
        patientId,
        proposed_icd10: primaryIcd10,
        proposed_cpt: serviceCode,
        confidence,
        reason: pairCheck.reason || 'invalid_code_pair'
      });
    }
    return {
      ok: false,
      status: 'CODING_REVIEW_REQUIRED',
      error_code: 'CODING_REVIEW_REQUIRED',
      message: 'Diagnosis and procedure codes are incompatible. A clinical reviewer must confirm before insurance verification.',
      code_pair_valid: false,
      pair_reason: pairCheck.reason
    };
  }

  return finalizeResolved(
    sessionId,
    {
      ok: true,
      status: 'OK',
      primary_icd10: primaryIcd10,
      primary_cpt: serviceCode,
      code_source: triageResult.primary_cpt ? 'spine' : cptResolution.code_source,
      fallback_reason: cptResolution.fallback_reason,
      rag_confidence: confidence,
      code_pair_valid: true,
      target_specialty: triageResult.target_specialty || null,
      coding_provenance: {
        code_source: triageResult.primary_cpt ? 'spine' : cptResolution.code_source,
        primary_icd10: primaryIcd10,
        primary_cpt: serviceCode,
        admin_path: false
      }
    },
    routing,
    opts
  );
}

function resolveInsuranceCodes(sessionId, opts = {}) {
  const started = Date.now();
  const result = resolveInsuranceCodesCore(sessionId, opts);
  const ms = Date.now() - started;
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionId || null,
      event_type: 'coding_resolution_latency',
      payload_json: {
        ms,
        ok: result?.ok === true,
        code_source: result?.code_source || null,
        primary_cpt: result?.primary_cpt || null
      }
    });
    if (ms > parseInt(process.env.CODING_RESOLUTION_P95_MS || '2500', 10)) {
      db.bumpOpsCounter?.('coding_resolution_sla_breach');
    }
  } catch (_) {}
  return result;
}

module.exports = { resolveInsuranceCodes, resolveInsuranceCodesCore };
