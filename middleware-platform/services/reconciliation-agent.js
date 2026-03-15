/**
 * Reconciliation Agent v0
 * 
 * Phase 0.5 test harness:
 * - Take a deposit (eg. USDC on/off-ramp event)
 * - Infer an expected claim amount from the memo (for demo: CLAIM-12345 = $100)
 * - Compute discrepancy and decide whether to auto-settle or flag for human review
 * - Log an ai_decisions_rcm record via the shared DB helper
 *
 * This keeps logic simple but exercises:
 * - insertRcmAiDecision (audit trail)
 * - /api/rcm/exceptions feeds (Provider "Reasoning Cards")
 */

const db = require('../database');

/**
 * Reconcile a single deposit against its inferred claim.
 *
 * @param {Object} deposit
 * @param {string} deposit.id
 * @param {number} deposit.amount
 * @param {string} [deposit.payer]
 * @param {string} [deposit.memo] - e.g. "CLAIM-12345-REMIT"
 * @param {string} [deposit.empi_id] - optional; if present, used for audit record
 * @returns {Promise<{requiresReview: boolean, explanation: string, delta: number, claimId: string|null}>}
 */
async function reconcileDeposit(deposit) {
  const amountPaid = Number(deposit.amount || 0);
  const memo = deposit.memo || '';

  // Simple test harness: extract CLAIM-XXXX from memo
  // Extract CLAIM-12345 from strings like "CLAIM-12345-REMIT"
  const claimMatch = memo.match(/CLAIM-([A-Za-z0-9]+)(?:[^0-9]|$)/i);
  const claimId = claimMatch ? `CLAIM-${claimMatch[1]}` : null;

  // For the stress test, assume expected amount = 100 when we see CLAIM-12345, else equal to paid (no discrepancy)
  let expectedAmount = amountPaid;
  if (claimId === 'CLAIM-12345') {
    expectedAmount = 100.0;
  }

  const delta = Number((expectedAmount - amountPaid).toFixed(2));
  const requiresReview = Math.abs(delta) >= 0.01;

  const explanation = requiresReview
    ? `Reconciliation Agent detected a mismatch: expected $${expectedAmount.toFixed(
        2
      )} for ${claimId || 'claim'}, but deposit ${deposit.id} from ${deposit.payer || 'payer'} was $${amountPaid.toFixed(
        2
      )}. Difference: $${delta.toFixed(2)}.`
    : `Reconciliation Agent matched deposit ${deposit.id} to ${claimId || 'claim'} with no material discrepancy.`;

  // Write audit trail when there is a discrepancy (surfaces in /api/rcm/exceptions)
  if (requiresReview) {
    try {
      db.insertRcmAiDecision({
        empi_id: deposit.empi_id || null,
        agent_type: 'reconciliation_agent',
        operation: 'deposit_claim_match',
        input_ref: {
          claim_id: claimId,
          deposit_id: deposit.id
        },
        input_snapshot: {
          deposit,
          expected_amount: expectedAmount
        },
        output_snapshot: {
          status: 'mismatch',
          delta,
          paid_amount: amountPaid,
          expected_amount: expectedAmount,
          action: 'Flag for provider review'
        },
        explanation,
        confidence: 0.98,
        requires_human_review: 1,
        metadata: {
          source: 'stress_test_v0'
        }
      });
    } catch (e) {
      // In tests we don't want failures to crash the process; log and continue
      // eslint-disable-next-line no-console
      console.warn('⚠️ Reconciliation Agent: failed to insert ai_decisions_rcm record:', e.message);
    }
  }

  return {
    requiresReview,
    explanation,
    delta,
    claimId
  };
}

module.exports = {
  reconcileDeposit
};

