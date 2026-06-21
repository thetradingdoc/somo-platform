'use strict';

/**
 * Shared insurance coding spine resolver (Kelly executor + voice HTTP).
 */

const TriageRAGService = require('./triage-rag-service');
const knowledgeService = require('./knowledge-service');
const { resolveCptForVisit } = require('../utils/cpt-helper');
const { CODING_CONFIDENCE_THRESHOLD, isConfidenceNearThreshold } = require('../config/coding-thresholds');

function resolveInsuranceCodes(sessionId, opts = {}) {
  const {
    service_code: clientServiceCode = null,
    adminOverride = false,
    force_after_clarified: forceAfterClarified = false,
    clinicId = null,
    patientId = null,
    flagHitl = null
  } = opts;

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

  const cptResolution = resolveCptForVisit({
    spineCpt: triageResult.primary_cpt || triageResult.cpt_codes?.[0]?.code || null,
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

  const codeValidation = knowledgeService.validateCodesExist({
    icd10: [primaryIcd10],
    cpt: [serviceCode]
  });
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

  return {
    ok: true,
    status: 'OK',
    primary_icd10: primaryIcd10,
    primary_cpt: serviceCode,
    code_source: cptResolution.code_source,
    fallback_reason: cptResolution.fallback_reason,
    rag_confidence: confidence,
    code_pair_valid: true,
    target_specialty: triageResult.target_specialty || null
  };
}

module.exports = { resolveInsuranceCodes };
