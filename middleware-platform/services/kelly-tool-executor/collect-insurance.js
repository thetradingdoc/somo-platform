'use strict';

const db = require('../../database');
const TriageRAGService = require('../triage-rag-service');
const { loadTenantPolicyFromProfile, TriagePolicy } = require('../conversation-mode/tenant-policy');
const { resolveAmountDue, logAmountResolution } = require('../resolve-amount-due');
const journeyGates = require('../journey-gates-service');

/**
 * Kelly collect_insurance tool — session gates, resolver, HTTP collect (quote from HTTP only).
 */
async function collectInsurance(KellyToolExecutor, executor, args, { sessionId, patientId, callerPhone }) {
  const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);

  const clinicId = args.clinic_id || null;
  let triagePolicy = null;
  let tenantSpecialty = args.tenant_specialty || args.specialty || null;
  try {
    const policy = loadTenantPolicyFromProfile(db, clinicId, args.customer_id || null);
    triagePolicy = policy.triage_policy;
    if (!tenantSpecialty && policy) {
      const profile = db.getClinicPromptProfile?.(clinicId, args.customer_id || null);
      tenantSpecialty = profile?.specialty || (triagePolicy === TriagePolicy.DISABLED ? 'Dental' : null);
    }
  } catch (_) {}

  const adminPath = triagePolicy === TriagePolicy.DISABLED;

  if (!adminPath) {
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

    if (!triageResult.target_specialty) {
      return {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
        error_code: 'TRIAGE_INCOMPLETE',
        message:
          "I'll confirm your coverage once we understand your needs better. Please complete triage first so we can verify the right specialty and codes."
      };
    }
  } else {
    const visitReason =
      args.visit_reason ||
      args.reason_for_visit ||
      KellyToolExecutor._getSessionMeta(sessionId, 'visit_reason') ||
      KellyToolExecutor._getSessionMeta(sessionId, 'reason_for_visit');
    if (!visitReason && !args.visit_reason) {
      return {
        success: false,
        error: 'VISIT_REASON_REQUIRED',
        error_code: 'VISIT_REASON_REQUIRED',
        message: 'What is the reason for your visit? For example, a cleaning, checkup, or new patient exam.'
      };
    }
    args.visit_reason = visitReason || args.visit_reason;
  }

  if (!args.date_of_birth && !args.dateOfBirth) {
    return {
      success: false,
      error: 'DOB_REQUIRED',
      error_code: 'DOB_REQUIRED',
      message: 'I need your date of birth to verify insurance with your plan.'
    };
  }

  const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';

  const { resolveInsuranceCodes } = require('../resolve-insurance-codes');
  const codingReviewSvc = require('../coding-review-service');
  const resolved = resolveInsuranceCodes(sessionId, {
    service_code: args.service_code,
    adminOverride: args.admin_coding_override === true || args.admin_coding_override === 'true',
    force_after_clarified: forceAfterClarified,
    clinicId,
    patientId: args.patient_id || patientId || null,
    flagHitl: (p) => codingReviewSvc.flagForReview(p),
    triage_policy: triagePolicy,
    visit_reason: args.visit_reason,
    tenantSpecialty,
    useAdminPath: adminPath
  });

  if (!resolved.ok) {
    if (resolved.error_code === 'CODE_NOT_IN_STARTER_SET') {
      const { emitCodingStarterSetMiss } = require('../resolve-admin-visit-codes');
      emitCodingStarterSetMiss({
        sessionId,
        clinicId,
        visitReason: args.visit_reason,
        channel: 'voice',
        tenantSpecialty
      });
    }
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
  console.log(
    '[coding_resolve] layer=kelly_executor phase=pre_http authoritative=true session_id=%s primary_cpt=%s',
    sessionId,
    serviceCode
  );
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
    const pid = insResult.patient_id || patientId || args.patient_id;
    const amountResolved = await resolveAmountDue({
      patientId: pid,
      sessionId,
      payerId: insResult.payer_id || args.payer_id,
      planId: args.plan_id,
      serviceCode: resolved.primary_cpt
    });
    let finalResolution = amountResolved;
    if (finalResolution.status !== 'hard_number') {
      const httpCopay =
        insResult.copay_due_now ??
        insResult.amount_resolution?.amount ??
        insResult.coverage?.copay_amount;
      if (httpCopay != null && insResult.quote_delivered === true) {
        finalResolution = {
          amount: Number(httpCopay),
          copay_due_now: Number(httpCopay),
          source: 'collect_http',
          status: 'hard_number'
        };
      }
    }
    if (finalResolution.status === 'hard_number') {
      const quoteGate = journeyGates.checkQuoteGate({ resolution: finalResolution });
      const spokenDelivery =
        insResult.quote_delivered === true || args.spoken_quote === true || args.deliver_quote === true;
      if (quoteGate.allowed && spokenDelivery) {
        KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '1');
        KellyToolExecutor._setSessionMeta(sessionId, 'last_quote_status', 'hard_number');
        KellyToolExecutor._setSessionMeta(sessionId, 'last_copay_due', String(finalResolution.amount));
        KellyToolExecutor._setSessionMeta(sessionId, 'copay_amount', String(finalResolution.amount));
      } else {
        KellyToolExecutor._setSessionMeta(sessionId, 'last_quote_status', quoteGate.status || finalResolution.status);
        KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '0');
        finalResolution = {
          ...finalResolution,
          status: quoteGate.status,
          notes: 'quote_gate_blocked'
        };
      }
    } else if (finalResolution.status === 'thin' || finalResolution.status === 'estimate') {
      KellyToolExecutor._setSessionMeta(sessionId, 'last_quote_status', finalResolution.status);
      KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '0');
    }
    logAmountResolution({
      patient_id: pid,
      session_id: sessionId,
      quoted_amount: finalResolution.amount,
      source: finalResolution.source,
      status: finalResolution.status,
      details: { tool: 'collect_insurance', payer_id: insResult.payer_id }
    });
    try {
      const { storeEligibilityOnSession } = require('../eligibility-session-store');
      const appointmentId =
        args.appointment_id ||
        KellyToolExecutor._getSessionMeta(sessionId, 'appointment_id') ||
        null;
      storeEligibilityOnSession({
        sessionId,
        appointmentId,
        patientId: pid,
        insResult,
        finalResolution
      });
    } catch (_) {}
    try {
      const orchestrator = require('../rcm-journey-orchestrator');
      let journeyId = KellyToolExecutor._getSessionMeta(sessionId, 'rcm_journey_id');
      if (!journeyId && pid && db.db) {
        const open = db.db
          .prepare(
            `SELECT id FROM rcm_journeys WHERE patient_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`
          )
          .get(String(pid));
        journeyId = open?.id || null;
      }
      if (journeyId && pid && clinicId) {
        orchestrator.syncCopayFromEligibility({
          clinicId,
          patientId: pid,
          journeyId: String(journeyId)
        });
      }
    } catch (_) {}

    const shouldWriteEligibility =
      pid &&
      clinicId &&
      (insResult.eligible === true || finalResolution.status === 'hard_number');
    if (shouldWriteEligibility) {
      const appointmentId =
        args.appointment_id ||
        KellyToolExecutor._getSessionMeta(sessionId, 'appointment_id') ||
        null;
      const { writeEligibilityNote } = require('../pms/pms-write-service');
      writeEligibilityNote(clinicId, {
        patient_id: pid,
        appointment_id: appointmentId,
        member_id: insResult.member_id || args.member_id,
        payer_id: insResult.payer_id || args.payer_id
      }).catch((e) => {
        console.warn('[collect_insurance] PMS eligibility note failed:', e.message);
      });
    }

    return {
      ...(insResult || {}),
      quote: insResult?.quote || null,
      amount_resolution: finalResolution,
      copay_due_now:
        finalResolution.status === 'hard_number' ? finalResolution.amount : insResult?.copay_due_now,
      message:
        finalResolution.status === 'hard_number' && finalResolution.amount != null
          ? `Based on your plan, your estimated copay for this visit is $${Number(finalResolution.amount).toFixed(2)}.`
          : insResult?.message
    };
  }
  return { ...(insResult || {}), quote: insResult?.quote || null };
}

module.exports = { collectInsurance };
