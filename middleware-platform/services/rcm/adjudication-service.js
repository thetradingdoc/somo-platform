/**
 * Adjudication Service
 * Real-time adjudication pipeline: applies payer rules and fee schedules
 * to produce pre-adjudication estimates before claim submission.
 *
 * Flow: Claim + Eligibility + Coding -> Fee Schedule Lookup -> EOB -> Settlement -> Adjudication Result
 */

const FeeScheduleService = require('./fee-schedule-service');
const EOBCalculationService = require('../clinical/eob-calculation-service');
const SettlementService = require('../platform/settlement-service');
const db = require('../../database');

/**
 * Run real-time adjudication for a claim.
 * Uses fee schedule when available for allowed amounts.
 * Includes Tiba settlement decision when coding available.
 *
 * @param {Object} params
 * @param {Object} params.claim - Claim
 * @param {Object} params.eligibility - Eligibility check
 * @param {Object} params.claimDetails - Parsed response_data (coding, pricing)
 * @returns {Object} { eob, feeScheduleUsed, preAdjudication, settlementDecision }
 */
function runAdjudication({ claim, eligibility = {}, claimDetails = {} }) {
  const payerId = claim?.payer_id || null;
  const feeScheduleUsed = payerId ? FeeScheduleService.hasFeeScheduleForPayer(payerId) : false;

  const eob = EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails);

  const codingResult = claimDetails?.coding || {};
  const providerNpi = claim?.provider_npi || null;
  const settlementDecision = SettlementService.getSettlementDecision(claim, codingResult, eob, { providerNpi });

  try {
    db.updateInsuranceClaim?.(claim.id, {
      settlement_state: 'pending',
      settlement_aggregate_confidence: settlementDecision.aggregateConfidence,
      settlement_amount_released: settlementDecision.amount,
      settlement_escrow_remainder: settlementDecision.escrowRemainder,
      settlement_decision: JSON.stringify({
        decision: settlementDecision.decision,
        amount: settlementDecision.amount,
        escrowRemainder: settlementDecision.escrowRemainder,
        aggregateConfidence: settlementDecision.aggregateConfidence,
        timestamp: new Date().toISOString()
      })
    });
  } catch (_) {}

  const preAdjudication = {
    claimId: claim?.id,
    payerId,
    feeScheduleUsed,
    estimatedPlanPaid: eob?.totals?.planPaid ?? 0,
    estimatedPatientOwe: eob?.totals?.whatYouOwe ?? 0,
    lineItemCount: eob?.lineItems?.length ?? 0,
    settlementDecision: {
      decision: settlementDecision.decision,
      amount: settlementDecision.amount,
      escrowRemainder: settlementDecision.escrowRemainder,
      aggregateConfidence: settlementDecision.aggregateConfidence,
      effectiveConfidence: settlementDecision.effectiveConfidence
    }
  };

  return {
    eob,
    feeScheduleUsed,
    preAdjudication,
    settlementDecision
  };
}

/**
 * Adjudicate before claim submission (estimate patient responsibility).
 * Used by UI or API to show "estimated amount" before submitting.
 */
function preAdjudicateClaim(claimId) {
  const claim = db.getClaimById?.(claimId);
  if (!claim) return { success: false, error: 'Claim not found' };

  let eligibility = null;
  if (claim.patient_id) {
    const checks = db.getEligibilityChecksByPatient?.(claim.patient_id) || [];
    eligibility = checks[0] || null;
  }

  let claimDetails = {};
  if (claim.response_data) {
    try {
      claimDetails = typeof claim.response_data === 'string'
        ? JSON.parse(claim.response_data)
        : claim.response_data;
    } catch (_) {}
  }

  const result = runAdjudication({ claim, eligibility, claimDetails });

  // Persist real_time_plan_paid for Tiba reconciliation (Phase 5)
  const estimatedPlan = result.preAdjudication?.estimatedPlanPaid ?? result.eob?.totals?.planPaid;
  if (estimatedPlan != null && (claim.real_time_plan_paid == null || claim.real_time_plan_paid === '')) {
    try {
      db.updateInsuranceClaim?.(claimId, { real_time_plan_paid: estimatedPlan });
    } catch (_) {}
  }

  return {
    success: true,
    ...result
  };
}

module.exports = {
  runAdjudication,
  preAdjudicateClaim
};
