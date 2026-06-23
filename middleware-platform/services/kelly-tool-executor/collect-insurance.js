'use strict';

const db = require('../../database');
const TriageRAGService = require('../clinical/triage-rag-service');

/**
 * Kelly collect_insurance tool — session gates, resolver, HTTP collect (quote from HTTP only).
 */
async function collectInsurance(KellyToolExecutor, executor, args, { sessionId, patientId, callerPhone }) {
  const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);

  const guardBlock = KellyToolExecutor._enforceKellyTriageGuardrails(sessionId, args, 'insurance');
  if (guardBlock) return guardBlock;

  const triageResult = TriageRAGService.getAuthoritativeForSession(sessionId);
  if (!triageResult) {
    bump('voice_agent_misuse_collect_insurance_no_rag_result');
    return {
      success: false,
      error: 'TRIAGE_REQUIRED',
      error_code: 'TRIAGE_REQUIRED',
      message:
        'Complete triage first with run_triage_rag to determine the right specialty and CPT code for insurance verification.'
    };
  }

  const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';

  if (!triageResult.target_specialty) {
    return {
      success: false,
      error: 'TRIAGE_INCOMPLETE',
      error_code: 'TRIAGE_INCOMPLETE',
      message:
        "I'll confirm your coverage once we understand your needs better. Please complete triage first so we can verify the right specialty and codes."
    };
  }

  const { resolveInsuranceCodes } = require('../shared/resolve-insurance-codes');
  const codingReviewSvc = require('../clinical/coding-review-service');
  const resolved = resolveInsuranceCodes(sessionId, {
    service_code: args.service_code,
    adminOverride: args.admin_coding_override === true || args.admin_coding_override === 'true',
    force_after_clarified: forceAfterClarified,
    clinicId: args.clinic_id || null,
    patientId: args.patient_id || patientId || null,
    flagHitl: (p) => codingReviewSvc.flagForReview(p)
  });

  if (!resolved.ok) {
    if (resolved.error_code === 'CODING_REVIEW_REQUIRED') {
      bump(
        resolved.pair_reason || resolved.code_pair_valid === false
          ? 'voice_agent_misuse_collect_insurance_invalid_codes'
          : 'voice_agent_misuse_collect_insurance_low_confidence'
      );
    } else if (
      resolved.error_code === 'CLIENT_SERVICE_CODE_REJECTED' ||
      resolved.error_code === 'INVALID_CODES'
    ) {
      bump('voice_agent_misuse_collect_insurance_invalid_codes');
    }
    return {
      success: false,
      error: resolved.error_code || resolved.status,
      error_code: resolved.error_code || resolved.status,
      message: resolved.message,
      invalid_codes: resolved.invalid_codes
    };
  }

  const serviceCode = resolved.primary_cpt;
  const primaryIcd10 = resolved.primary_icd10;

  console.log('[collect_insurance] code selection', {
    code_source: resolved.code_source,
    fallback_reason: resolved.fallback_reason,
    primary_icd10: primaryIcd10,
    primary_cpt: serviceCode,
    session_id: sessionId
  });
  KellyToolExecutor._logCodingProvenance(sessionId, {
    tool: 'collect_insurance',
    code_source: resolved.code_source,
    fallback_reason: resolved.fallback_reason,
    primary_icd10: primaryIcd10,
    primary_cpt: serviceCode,
    rag_confidence: resolved.rag_confidence,
    code_pair_valid: resolved.code_pair_valid
  });

  let initialName = args.initial_name || null;
  if (!initialName && sessionId && db.getOrchestrateSessionBySessionId) {
    try {
      const row = db.getOrchestrateSessionBySessionId(sessionId);
      initialName = row?.flow_state?.initial_name || null;
    } catch (_) {}
  }

  const insResult = await executor._post('/voice/insurance/collect', {
    ...args,
    patient_phone: args.patient_phone || callerPhone || undefined,
    call_id: sessionId,
    primary_icd10: resolved.primary_icd10,
    primary_cpt: serviceCode,
    code_source: resolved.code_source,
    payer_id: args.payer_id,
    plan_id: args.plan_id,
    initial_name: initialName || undefined,
    force_after_clarified: forceAfterClarified || undefined
  });

  if (insResult?.success) {
    KellyToolExecutor._clearHitlResumeOnCollectSuccess(sessionId);
  }
  return { ...(insResult || {}), quote: insResult?.quote || null };
}

module.exports = { collectInsurance };
