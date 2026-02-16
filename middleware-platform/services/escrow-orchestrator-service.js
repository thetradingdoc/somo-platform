/**
 * Escrow Orchestrator Service
 * Decides when to use conditional escrow vs direct Circle transfer.
 * When PoC + settlement rules pass, enables logic-based release.
 *
 * Flow:
 * 1. Claim approved -> check PoC + settlement rules
 * 2. If both pass and ESCROW_ENABLED=1 -> route to escrow (pending)
 * 3. Backend (relayer) calls releaseImpactWeighted(escrowHash) on contract
 *
 * Impact-Weighted: Returns patientHSA, healthcareStaff, splits for 50/20/20/10.
 * Tier 2 (rare): Requires M-of-N specialist signatures (enforced by caller).
 */

const SettlementRulesService = require('./settlement-rules-service');
const ProofOfCareService = require('./proof-of-care-service');
const SettlementService = require('./settlement-service');

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
  const impactTier = claim?.impact_tier ?? 1;
  // Tier 2: require M-of-N (2) specialist signatures - verified in PoC
  const tier2Ok = impactTier !== 2 || proofOfCare.evidence?.some(e => e.rule === 'm_of_n_specialists' && e.count >= 2);
  const pocOk = proofOfCare.verified && tier2Ok;

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

  const planPaidAmount = eobCalculation?.totals?.planPaid ?? claim.insurance_amount;
  const impactTier = claim.impact_tier ?? 1;
  const multiplier = SettlementService.getImpactWeightMultiplier(impactTier);
  const splits = SettlementService.computeImpactWeightedSplits(planPaidAmount, multiplier);

  const patient = claim.patient_id && db.getFHIRPatient ? db.getFHIRPatient(claim.patient_id) : null;
  const patientHSA = patient?.patient_wallet_address || claim.patient_hsa_address || null;

  return {
    shouldRelease: route.canRelease && route.route === 'escrow',
    route,
    planPaidAmount,
    impactTier,
    splits,
    releasePayload: {
      patientHSA,
      healthcareStaff: claim.healthcare_staff_address || null,
      dataIntegrityHash: claim.data_integrity_hash || null,
      escrowHash: claim.escrow_hash || null,
      impactTier
    }
  };
}

/**
 * Build payload for HealthcareEscrow.releaseImpactWeighted(escrowHash).
 * Caller must have escrowHash from deposit; addresses from claim/patient.
 */
function buildReleasePayload(claim, db) {
  const patient = claim.patient_id ? db.getFHIRPatient?.(claim.patient_id) : null;
  return {
    escrowHash: claim.escrow_hash,
    patientHSA: patient?.patient_wallet_address || claim.patient_hsa_address,
    healthcareStaff: claim.healthcare_staff_address,
    dataIntegrityHash: claim.data_integrity_hash,
    impactTier: claim.impact_tier ?? 1
  };
}

/**
 * Data Request flow: Pharma pays for research data (bounty), not insurance claim.
 * When type === 'data_request', evaluate bounty fulfillment + PoC for escrow release.
 */
async function getDataRequestSettlementRoute({ bounty, fulfillmentCount = 0, proofOfCare }) {
  const useEscrow = process.env.ESCROW_ENABLED === '1' || process.env.ESCROW_ENABLED === 'true';
  const targetCount = bounty?.target_count ?? 0;
  const fulfilled = fulfillmentCount >= targetCount;
  const pocOk = proofOfCare?.verified ?? false;
  const canRelease = fulfilled && pocOk;

  return {
    route: useEscrow && canRelease ? 'escrow' : 'direct',
    canRelease,
    proofOfCare,
    fulfillmentCount,
    targetCount,
    fulfilled
  };
}

module.exports = {
  getSettlementRoute,
  shouldTriggerEscrowRelease,
  buildReleasePayload,
  getDataRequestSettlementRoute
};
