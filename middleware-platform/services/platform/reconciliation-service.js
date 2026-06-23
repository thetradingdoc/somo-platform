/**
 * Reconciliation Service (Tiba Spec 4.3, 3.4)
 * Post-adjudication: compare final plan paid (from 277/835) to real-time EOB estimate.
 * Δ_plan = final_R_plan - real_time_R_plan
 * Tolerance: auto-reconcile when |Δ| ≤ $10 or |Δ|/a ≤ 5%; else flag for manual.
 */

const DELTA_ABS = parseFloat(process.env.RECONCILIATION_DELTA_ABS || '10');
const DELTA_PCT = parseFloat(process.env.RECONCILIATION_DELTA_PCT || '5');

/**
 * Compute reconciliation between real-time EOB and final adjudication.
 *
 * @param {Object} claim - Claim with real_time_plan_paid
 * @param {number} finalPlanPaid - From 277/835 or paymentAmount when approved/paid
 * @param {Object} eob - EOB (for allowed amount a in tolerance check)
 * @returns {{ deltaPlan: number, withinTolerance: boolean, action: string, releaseAmount?: number, recoverAmount?: number }}
 */
function computeReconciliation(claim, finalPlanPaid, eob = {}) {
  const realTime = parseFloat(claim.real_time_plan_paid ?? claim.response_data?.real_time_plan_paid ?? 0);
  const finalR = parseFloat(finalPlanPaid || 0);
  const deltaPlan = finalR - realTime;

  const allowedTotal = parseFloat(eob.totals?.allowedAmount || 0) || 1;
  const deltaAbsOk = Math.abs(deltaPlan) <= DELTA_ABS;
  const deltaPctOk = allowedTotal > 0 && Math.abs(deltaPlan) / allowedTotal <= DELTA_PCT / 100;
  const withinTolerance = deltaAbsOk || deltaPctOk;

  let action = 'none';
  let releaseAmount = 0;
  let recoverAmount = 0;

  if (deltaPlan > 0) {
    action = withinTolerance ? 'release_additional' : 'flag_release';
    releaseAmount = deltaPlan;
  } else if (deltaPlan < 0) {
    action = withinTolerance ? 'recover' : 'flag_recover';
    recoverAmount = Math.abs(deltaPlan);
  }

  return {
    deltaPlan,
    withinTolerance,
    action,
    releaseAmount,
    recoverAmount,
    realTimePlanPaid: realTime,
    finalPlanPaid: finalR
  };
}

/**
 * Extract final plan paid from claim status/ERA response.
 * When 277/835 available, parse from segments; else use paymentAmount.
 *
 * @param {Object} statusResponse - From checkClaimStatus or 277/835 parse
 * @returns {number|null}
 */
function extractFinalPlanPaid(statusResponse) {
  if (!statusResponse) return null;
  if (typeof statusResponse.paymentAmount === 'number') return statusResponse.paymentAmount;
  if (statusResponse.paymentAmount != null) return parseFloat(statusResponse.paymentAmount);
  if (statusResponse.finalPlanPaid != null) return parseFloat(statusResponse.finalPlanPaid);
  return null;
}

module.exports = {
  computeReconciliation,
  extractFinalPlanPaid,
  DELTA_ABS,
  DELTA_PCT
};
