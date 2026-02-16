/**
 * Settlement Service (Tiba Spec 4)
 * Confidence-weighted settlement: aggregate confidence Φ and settlement amount S(R_plan, Φ).
 * Φ_effective = Φ × τ_provider when provider trust score available.
 *
 * Impact-Weighted Extension: 50/20/20/10 split for escrow release.
 * impact_weight_multiplier boosts settlement for rare cases (e.g., cancer).
 */

const db = require('../database');
const THETA_HIGH = parseFloat(process.env.THETA_HIGH || '0.95');
const THETA_LOW = parseFloat(process.env.THETA_LOW || '0.70');
const ALPHA = parseFloat(process.env.ALPHA || '0.7');

// Impact-weighted split (basis points, 10000 = 100%)
const IMPACT_SPLIT = {
  patientBps: 5000,   // 50% to Patient HSA
  staffBps: 2000,     // 20% to Healthcare Staff
  investorBps: 2000,  // 20% to Investor Pool
  protocolBps: 1000   // 10% to Protocol Treasury
};

/**
 * Compute aggregate confidence Φ per Tiba spec 4.
 * Φ_weighted = Σ(φ_i × r^plan_i) / R_plan
 * Φ_min = min(φ_1, ..., φ_n)
 * Φ = α × Φ_weighted + (1 - α) × Φ_min
 *
 * @param {Array} codes - CPT codes with confidence: [{ code, confidence, quantity? }]
 * @param {Object} eob - EOB result with lineItems and totals
 * @param {Object} config - { alpha } (optional)
 * @returns {{ aggregate: number, weighted: number, min: number }}
 */
function computeAggregateConfidence(codes = [], eob = {}, config = {}) {
  const alpha = config.alpha ?? ALPHA;
  const lineItems = eob.lineItems || [];
  const R_plan = parseFloat(eob.totals?.planPaid || 0);

  if (codes.length === 0) {
    return { aggregate: 0.5, weighted: 0.5, min: 0.5 };
  }

  const confidences = codes.map(c => {
    const conf = typeof c.confidence === 'number' ? c.confidence : 0.8;
    return Math.min(1, Math.max(0, conf));
  });
  const phiMin = Math.min(...confidences);

  if (R_plan <= 0) {
    return { aggregate: phiMin, weighted: phiMin, min: phiMin };
  }

  const codeToConf = new Map();
  codes.forEach(c => {
    const k = (c.code || c).toString().trim();
    const conf = typeof c.confidence === 'number' ? c.confidence : 0.8;
    codeToConf.set(k, Math.min(1, Math.max(0, conf)));
  });

  let weightedSum = 0;
  for (const line of lineItems) {
    const cptCode = (line.cptCode || line.code || '').toString().trim();
    const planPaid = parseFloat(line.planPaid || 0);
    const phi = codeToConf.get(cptCode) ?? 0.8;
    weightedSum += phi * planPaid;
  }

  const phiWeighted = weightedSum / R_plan;
  const phi = alpha * phiWeighted + (1 - alpha) * phiMin;

  return {
    aggregate: Math.min(1, Math.max(0, phi)),
    weighted: Math.min(1, Math.max(0, phiWeighted)),
    min: phiMin
  };
}

/**
 * Compute settlement amount S(R_plan, Φ) per Tiba spec 4.2.
 *
 * @param {number} R_plan - Total plan paid
 * @param {number} phi - Aggregate confidence
 * @param {Object} config - { thetaHigh, thetaLow } (optional)
 * @returns {{ amount: number, decision: string, escrowRemainder: number }}
 */
function computeSettlementAmount(R_plan, phi, config = {}) {
  const thetaHigh = config.thetaHigh ?? THETA_HIGH;
  const thetaLow = config.thetaLow ?? THETA_LOW;
  const R = parseFloat(R_plan || 0);
  const p = Math.min(1, Math.max(0, phi));

  if (p >= thetaHigh) {
    return { amount: R, decision: 'full', escrowRemainder: 0 };
  }
  if (p >= thetaLow) {
    const amount = Math.round(R * p * 100) / 100;
    const escrowRemainder = Math.round(R * (1 - p) * 100) / 100;
    return { amount, decision: 'partial', escrowRemainder };
  }
  return { amount: 0, decision: 'hold', escrowRemainder: R };
}

/**
 * Get effective confidence Φ_effective = Φ × τ_provider (Tiba spec 5.5, 5.6).
 * @param {number} phi - Aggregate confidence
 * @param {string} providerNpi - Provider NPI
 * @returns {number}
 */
function getEffectiveConfidence(phi, providerNpi) {
  if (!providerNpi) return phi;
  const tau = db.getProviderTrustScore?.(providerNpi);
  if (tau == null) return phi;
  return Math.min(1, phi * Math.max(0, tau));
}

/**
 * Get settlement decision for a claim (Tiba spec 4).
 * Uses Φ_effective = Φ × τ_provider when providerNpi provided.
 *
 * @param {Object} claim - Claim object (may have provider_npi or appointment)
 * @param {Object} codingResult - From runCodingPipeline or claimDetails.coding: { cpt, icd10 }
 * @param {Object} eob - EOB from calculateEOBFromClaim
 * @param {Object} config - { alpha, thetaHigh, thetaLow, providerNpi }
 * @returns {{ decision: string, amount: number, escrowRemainder: number, aggregateConfidence: number, effectiveConfidence?: number, weighted: number, min: number }}
 */
function getSettlementDecision(claim, codingResult = {}, eob = {}, config = {}) {
  const cpt = codingResult.cpt || [];
  const conf = computeAggregateConfidence(cpt, eob, { alpha: config.alpha });
  const providerNpi = config.providerNpi || claim?.provider_npi || null;
  const phiEffective = getEffectiveConfidence(conf.aggregate, providerNpi);
  const R_plan = parseFloat(eob.totals?.planPaid || 0);
  const settlement = computeSettlementAmount(R_plan, phiEffective, {
    thetaHigh: config.thetaHigh,
    thetaLow: config.thetaLow
  });

  const out = {
    decision: settlement.decision,
    amount: settlement.amount,
    escrowRemainder: settlement.escrowRemainder,
    aggregateConfidence: conf.aggregate,
    weighted: conf.weighted,
    min: conf.min
  };
  if (providerNpi) out.effectiveConfidence = phiEffective;
  return out;
}

/**
 * Compute 50/20/20/10 split amounts for impact-weighted escrow release.
 * @param {number} totalAmount - Total settlement amount (USDC units)
 * @param {number} impactWeightMultiplier - Boost for rare cases (1.0 = no boost, 1.5 = 50% boost)
 * @returns {{ patientAmount: number, staffAmount: number, investorAmount: number, protocolAmount: number }}
 */
function computeImpactWeightedSplits(totalAmount, impactWeightMultiplier = 1.0) {
  const base = Math.round(parseFloat(totalAmount || 0) * Math.max(0.5, Math.min(2, impactWeightMultiplier)) * 100) / 100;
  const bps = 10000;
  return {
    patientAmount: Math.round((base * IMPACT_SPLIT.patientBps) / bps * 100) / 100,
    staffAmount: Math.round((base * IMPACT_SPLIT.staffBps) / bps * 100) / 100,
    investorAmount: Math.round((base * IMPACT_SPLIT.investorBps) / bps * 100) / 100,
    protocolAmount: Math.round((base * IMPACT_SPLIT.protocolBps) / bps * 100) / 100,
    totalAmount: base
  };
}

/**
 * Get impact weight multiplier for disease rarity.
 * Tier 1 (common): 1.0; Tier 2 (rare/cancer): configurable (default 1.2).
 */
function getImpactWeightMultiplier(impactTier = 1) {
  const tierMultipliers = {
    1: parseFloat(process.env.IMPACT_TIER_1_MULTIPLIER || '1.0'),
    2: parseFloat(process.env.IMPACT_TIER_2_MULTIPLIER || '1.2')
  };
  return tierMultipliers[impactTier] ?? 1.0;
}

module.exports = {
  computeAggregateConfidence,
  computeSettlementAmount,
  getSettlementDecision,
  getEffectiveConfidence,
  computeImpactWeightedSplits,
  getImpactWeightMultiplier,
  IMPACT_SPLIT,
  THETA_HIGH,
  THETA_LOW,
  ALPHA
};
