/**
 * Settlement Service (Tiba Spec 4)
 * Confidence-weighted settlement: aggregate confidence Φ and settlement amount S(R_plan, Φ).
 * Φ_effective = Φ × τ_provider when provider trust score available.
 *
 * Impact-Weighted Extension: 50/20/20/10 split for escrow release.
 * impact_weight_multiplier boosts settlement for rare cases (e.g., cancer).
 */

const crypto = require('crypto');
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
  
  // Check if getProviderTrustScore exists (defensive)
  if (typeof db.getProviderTrustScore !== 'function') {
    console.warn(`⚠️  db.getProviderTrustScore not available - τ_provider feature inactive. Provider trust scores will not be applied.`);
    return phi;
  }
  
  const tau = db.getProviderTrustScore(providerNpi);
  if (tau == null) {
    // New provider: default to neutral trust (0.5) instead of full trust (1.0)
    // This prevents new providers from gaming early claims
    // IMPORTANT: τ = 0.5 means Φ_effective = Φ × 0.5
    // Example: Φ = 0.95 → Φ_effective = 0.475 (below THETA_LOW = 0.70) → forces HOLD
    // This is intentional probationary period - all new provider claims require manual review
    // Document this in provider onboarding: "First N claims require manual review for trust establishment"
    const defaultTau = parseFloat(process.env.DEFAULT_PROVIDER_TRUST_SCORE || '0.5');
    console.log(`ℹ️  Provider ${providerNpi} has no trust score - using default τ=${defaultTau} (probationary period - all claims will be HOLD until trust score established)`);
    return Math.min(1, phi * Math.max(0, defaultTau));
  }
  
  return Math.min(1, phi * Math.max(0, tau));
}

/**
 * Generate proof-of-care hash (Tiba Spec 5.3, 5.4).
 * V(E,C,π) = SHA256(encounter_notes|codes_json|timestamp)
 * Used for blockchain escrow verification when enabled.
 *
 * @param {string} encounterNotes - Clinical notes or encounter summary
 * @param {Object|Array} codes - ICD/CPT codes (object or array, will be JSON-stringified)
 * @param {string|Date} timestamp - ISO timestamp
 * @returns {string} SHA256 hex hash
 */
function generateProofOfCare(encounterNotes, codes, timestamp) {
  const ts = typeof timestamp === 'string' ? timestamp : (timestamp ? new Date(timestamp).toISOString() : new Date().toISOString());
  const notes = String(encounterNotes || '').trim();
  const codesStr = typeof codes === 'object' ? JSON.stringify(codes) : String(codes || '');
  const payload = `${notes}|${codesStr}|${ts}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Get settlement decision for a claim (Tiba spec 4).
 * Uses Φ_effective = Φ × τ_provider when providerNpi provided.
 *
 * CRITICAL: If codingResult.needsReview === true, forces decision to 'hold' regardless of confidence.
 * This prevents low-quality LLM coding results from triggering instant settlement before human review.
 *
 * @param {Object} claim - Claim object (may have provider_npi or appointment)
 * @param {Object} codingResult - From runCodingPipeline or claimDetails.coding: { cpt, icd10, needsReview?, band? }
 * @param {Object} eob - EOB from calculateEOBFromClaim
 * @param {Object} config - { alpha, thetaHigh, thetaLow, providerNpi }
 * @returns {{ decision: string, amount: number, escrowRemainder: number, aggregateConfidence: number, effectiveConfidence?: number, weighted: number, min: number, blockedByReview?: boolean }}
 */
function getSettlementDecision(claim, codingResult = {}, eob = {}, config = {}) {
  // CRITICAL FIX: Block settlement if coding requires human review
  const needsReview = codingResult.needsReview === true || codingResult.action === 'route_to_manual_review';
  const isComplexBand = codingResult.band === 'COMPLEX';
  
  if (needsReview) {
    const R_plan = parseFloat(eob.totals?.planPaid || 0);
    console.warn(`🚨 Settlement BLOCKED: Coding requires human review (needsReview=${needsReview}, band=${codingResult.band})`);
    return {
      decision: 'hold',
      amount: 0,
      escrowRemainder: R_plan,
      aggregateConfidence: 0,
      weighted: 0,
      min: 0,
      blockedByReview: true,
      reason: `Coding flagged for review (band: ${codingResult.band}, needsReview: ${needsReview})`
    };
  }
  
  // Note: COMPLEX claims with needsReview are already blocked above.
  // This cap only applies to high-confidence COMPLEX claims that passed review threshold.
  // Consider removing if it creates unnecessary manual review volume in production.
  const cpt = codingResult.cpt || [];
  let conf = computeAggregateConfidence(cpt, eob, { alpha: config.alpha });
  
  // Only apply cap if feature flag enabled (default: disabled to avoid over-conservative holds)
  const applyComplexCap = process.env.COMPLEX_CONFIDENCE_CAP_ENABLED === '1' || process.env.COMPLEX_CONFIDENCE_CAP_ENABLED === 'true';
  if (applyComplexCap && isComplexBand && conf.aggregate < parseFloat(process.env.COMPLEX_CONFIDENCE_THRESHOLD || '0.85')) {
    const phiAuthCap = parseFloat(process.env.PHI_AUTH_CAP || '0.6');
    console.warn(`⚠️  COMPLEX coding confidence ${conf.aggregate.toFixed(2)} below threshold - capping at φ_auth_cap=${phiAuthCap}`);
    conf.aggregate = Math.min(conf.aggregate, phiAuthCap);
    conf.weighted = Math.min(conf.weighted, phiAuthCap);
  }
  
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
 * 
 * ⚠️ RUNTIME GUARD: This function MUST ONLY be used for:
 * - Research bounties (pharma data requests) - NOT insurance reimbursements
 * - Escrow releases (when ESCROW_ENABLED=1) - NOT standard claim payments
 * 
 * DO NOT use this for standard insurance claim reimbursements. Insurance pays the provider directly.
 * Splitting insurance reimbursements before provider payment reconciliation creates legal exposure.
 * 
 * @param {number} totalAmount - Total settlement amount (USDC units)
 * @param {number} impactWeightMultiplier - Boost for rare cases (1.0 = no boost, 1.5 = 50% boost)
 * @param {Object} options - { allowInsuranceClaims?: boolean, context?: string }
 * @returns {{ patientAmount: number, staffAmount: number, investorAmount: number, protocolAmount: number }}
 */
function computeImpactWeightedSplits(totalAmount, impactWeightMultiplier = 1.0, options = {}) {
  // Runtime guard: prevent misuse on insurance claims unless explicitly allowed
  const allowInsuranceClaims = options.allowInsuranceClaims === true;
  const context = options.context || 'unknown';
  
  if (!allowInsuranceClaims && context.includes('insurance') && context.includes('claim')) {
    throw new Error(`SECURITY: computeImpactWeightedSplits cannot be used for insurance claims. Context: ${context}. This function is only for research bounties and escrow releases.`);
  }
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
  generateProofOfCare,
  computeImpactWeightedSplits,
  getImpactWeightMultiplier,
  IMPACT_SPLIT,
  THETA_HIGH,
  THETA_LOW,
  ALPHA
};
