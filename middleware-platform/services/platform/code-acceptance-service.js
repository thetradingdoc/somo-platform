/**
 * Code Acceptance Service (Tiba Phase 4 - φ^historical_i)
 * Tracks (payer, CPT) acceptance/denial from claim outcomes.
 * Provides historical confidence for coding pipeline.
 */

const db = require('../../database');
const cache = require('./cache-service');

/**
 * Track claim outcome for code acceptance rates.
 * Call when claim status becomes approved/denied/paid.
 *
 * @param {string} claimId - Claim ID
 * @param {Array} codes - CPT codes: [{ code }] or strings
 * @param {string} status - 'approved', 'paid', 'denied', 'rejected'
 * @param {string} payerId - Payer ID
 */
function trackCodeOutcome(claimId, codes = [], status, payerId) {
  if (!payerId || !codes || codes.length === 0) return;
  const accepted = status === 'approved' || status === 'paid';
  const denied = status === 'denied' || status === 'rejected';
  if (!accepted && !denied) return;

  for (const c of codes) {
    const code = typeof c === 'object' ? (c.code || c.cpt_code) : c;
    if (code && String(code).trim() && String(code) !== 'N/A') {
      try {
        db.upsertCodeAcceptance?.(payerId, code, accepted);
      } catch (e) {
        console.warn('⚠️  Code acceptance tracking failed:', e.message);
      }
    }
  }
  try {
    cache.clear?.('code_acceptance');
  } catch (_) {}
}

/**
 * Get historical confidence (φ^historical_i) for (payer, CPT).
 * Returns acceptance_rate = acceptance_count / (acceptance_count + denial_count).
 * Default 1.0 when no history.
 *
 * @param {string} payerId - Payer ID
 * @param {string} cptCode - CPT code
 * @returns {number} 0..1
 */
function getHistoricalConfidence(payerId, cptCode) {
  if (!payerId || !cptCode) return 1.0;
  const key = `${String(payerId).trim().toUpperCase()}|${String(cptCode).trim()}`;
  const cached = cache.get?.('code_acceptance', key);
  if (typeof cached === 'number') return cached;

  const row = db.getCodeAcceptanceRate?.(payerId, cptCode);
  if (!row) {
    cache.set?.('code_acceptance', 1.0, key);
    return 1.0;
  }
  const total = (row.acceptance_count || 0) + (row.denial_count || 0);
  const rate = total > 0 ? (row.acceptance_count || 0) / total : 1.0;
  cache.set?.('code_acceptance', rate, key);
  return rate;
}

/**
 * Update provider trust score after claim adjudication (Tiba τ_provider).
 * τ(t+1) = 0.9 × τ(t) + 0.1 × (1 if accepted else 0)
 * denial_rate(t+1) = 0.9 × denial_rate(t) + 0.1 × (0 if accepted else 1)
 *
 * @param {string} providerNpi - Provider NPI
 * @param {boolean} accepted - Claim approved/paid
 */
function updateProviderTrustScore(providerNpi, accepted) {
  if (!providerNpi) return;
  const tau = db.getProviderTrustScore?.(providerNpi) ?? 1.0;
  const newTau = 0.9 * tau + 0.1 * (accepted ? 1 : 0);
  const currentDenial = db.getProviderDenialRate?.(providerNpi) ?? 0;
  const newDenial = 0.9 * currentDenial + 0.1 * (accepted ? 0 : 1);
  try {
    db.upsertProviderTrustMetric?.(providerNpi, {
      trust_score: Math.min(1, Math.max(0, newTau)),
      denial_rate: Math.min(1, Math.max(0, newDenial))
    });
  } catch (e) {
    console.warn('⚠️  Provider trust update failed:', e.message);
  }
}

module.exports = {
  trackCodeOutcome,
  getHistoricalConfidence,
  updateProviderTrustScore
};
