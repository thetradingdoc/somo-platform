/**
 * Escrow Orchestrator Service
 * Decides when to use conditional escrow vs direct Circle transfer.
 * When PoC + settlement rules pass, enables logic-based release.
 *
 * Flow:
 * 1. Claim approved -> check PoC + settlement rules
 * 2. If both pass and ESCROW_ENABLED=1 -> route to escrow (pending)
 * 3. Backend (relayer) calls release on contract when ready
 *
 * When ESCROW_ENABLED=0 (default): use existing Circle direct transfer.
 */

const SettlementRulesService = require('./settlement-rules-service');
const ProofOfCareService = require('./proof-of-care-service');

/**
 * Determine settlement route: direct transfer vs escrow.
 *
 * @param {Object} params
 * @param {Object} params.claim - Claim
 * @param {Object} params.claimDetails - Parsed response_data
 * @param {Object} params.eobCalculation - EOB result
 * @param {Object} params.eligibility - Eligibility check
 * @returns {Promise<Object>} { route: 'direct'|'escrow', canRelease, proofOfCare, settlementEvaluation }
 */
async function getSettlementRoute({ claim, claimDetails = {}, eobCalculation = {}, eligibility = {} }) {
  const useEscrow = process.env.ESCROW_ENABLED === '1' || process.env.ESCROW_ENABLED === 'true';

  const settlementEvaluation = SettlementRulesService.evaluateSettlementRules({
    claim,
    claimDetails,
    eobCalculation,
    eligibility
  });

  const proofOfCare = await ProofOfCareService.verifyProofOfCare(claim);

  const settlementOk = settlementEvaluation.action === 'auto_approve';
  const pocOk = proofOfCare.verified;

  const canRelease = settlementOk && pocOk;

  return {
    route: useEscrow && canRelease ? 'escrow' : 'direct',
    canRelease,
    proofOfCare,
    settlementEvaluation,
    useEscrow
  };
}

/**
 * Check if escrow release should be triggered (for relayer/backend).
 * Called when processing approved claims with escrow flow.
 */
async function shouldTriggerEscrowRelease(claimId, db) {
  const claim = db.getClaimById?.(claimId);
  if (!claim) return { shouldRelease: false, reason: 'Claim not found' };

  let claimDetails = {};
  if (claim.response_data) {
    try {
      claimDetails = typeof claim.response_data === 'string'
        ? JSON.parse(claim.response_data)
        : claim.response_data;
    } catch (_) {}
  }

  let eligibility = null;
  if (claim.patient_id) {
    const checks = db.getEligibilityChecksByPatient?.(claim.patient_id) || [];
    eligibility = checks[0] || null;
  }

  const EOBCalculationService = require('./eob-calculation-service');
  let eobCalculation = {};
  try {
    eobCalculation = EOBCalculationService.calculateEOBFromClaim(claim, eligibility || {}, claimDetails);
  } catch (_) {}

  const route = await getSettlementRoute({
    claim,
    claimDetails,
    eobCalculation,
    eligibility
  });

  return {
    shouldRelease: route.canRelease && route.route === 'escrow',
    route,
    planPaidAmount: eobCalculation?.totals?.planPaid ?? claim.insurance_amount
  };
}

module.exports = {
  getSettlementRoute,
  shouldTriggerEscrowRelease
};
