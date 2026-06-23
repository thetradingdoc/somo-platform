/**
 * Escrow Recovery Service
 * 
 * Handles recovery of stuck escrow funds when Transfer 1 succeeds but Transfer 2/3 fail.
 * Uses idempotency keys to prevent double-payment on retries.
 * 
 * Recovery scenarios:
 * 1. Transfer 1 completed, Transfer 2 failed → Retry Transfer 2
 * 2. Transfer 1 completed, Transfer 2 completed, Transfer 3 failed → Retry Transfer 3
 * 3. Transfer 1 completed, but process crashed before recording Transfer 2 → Retry Transfer 2 (idempotency protects)
 */

const db = require('../../database');
const CircleService = require('./circle-service');

/**
 * Recover a stuck escrow for a specific claim
 * 
 * @param {string} claimId - Claim ID
 * @returns {Promise<{success: boolean, recovered: Array, error?: string}>}
 */
async function recoverStuckEscrow(claimId) {
  try {
    const attempt = db.getSettlementAttemptByClaimId(claimId);
    
    if (!attempt) {
      return {
        success: false,
        error: `No settlement attempt found for claim ${claimId}`
      };
    }

    // Check if already completed
    if (attempt.transfer_1_status === 'completed' && 
        attempt.transfer_2_status === 'completed' && 
        attempt.transfer_3_status === 'completed') {
      return {
        success: true,
        recovered: [],
        message: 'Settlement already completed - no recovery needed'
      };
    }

    // Check if Transfer 1 didn't complete (can't recover)
    if (attempt.transfer_1_status !== 'completed') {
      return {
        success: false,
        error: `Transfer 1 not completed (status: ${attempt.transfer_1_status}) - cannot recover`
      };
    }

    const recovered = [];
    const errors = [];

    // Recovery scenario 1: Transfer 2 failed or not started
    if (attempt.transfer_2_status !== 'completed') {
      try {
        console.log(`🔄 Recovering Transfer 2 for claim ${claimId}...`);
        
        // Use idempotency key: claimId-transfer-2 (prevents double-payment if original succeeded)
        const idempotencyKey = `${claimId}-transfer-2`;
        
        const transfer2Result = await CircleService.createTransfer({
          fromWalletId: attempt.escrow_wallet_id,
          toWalletId: attempt.provider_wallet_id,
          amount: attempt.provider_amount,
          currency: 'USDC',
          claimId: claimId,
          description: `Provider payment recovery for claim ${claimId}`,
          idempotencyKey: idempotencyKey
        });

        if (transfer2Result.success) {
          // Update attempt record
          db.updateSettlementAttempt(claimId, {
            transfer_2_status: 'completed',
            transfer_2_circle_id: transfer2Result.transferId,
            transfer_2_id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          });

          // Also record in circle_transfers table
          db.createCircleTransfer({
            id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            claim_id: claimId,
            from_wallet_id: attempt.escrow_wallet_id,
            to_wallet_id: attempt.provider_wallet_id,
            amount: attempt.provider_amount,
            currency: 'USDC',
            circle_transfer_id: transfer2Result.transferId,
            status: transfer2Result.status || 'completed'
          });

          recovered.push({
            transfer: 'transfer_2',
            amount: attempt.provider_amount,
            circleTransferId: transfer2Result.transferId
          });
          console.log(`✅ Transfer 2 recovered: ${transfer2Result.transferId}`);
        } else {
          errors.push({
            transfer: 'transfer_2',
            error: transfer2Result.error
          });
          db.updateSettlementAttempt(claimId, {
            transfer_2_status: 'failed',
            error_message: `Recovery failed: ${transfer2Result.error}`
          });
        }
      } catch (error) {
        errors.push({
          transfer: 'transfer_2',
          error: error.message
        });
        db.updateSettlementAttempt(claimId, {
          transfer_2_status: 'failed',
          error_message: `Recovery error: ${error.message}`
        });
      }
    }

    // Recovery scenario 2: Transfer 3 failed or not started (only if Transfer 2 completed)
    const updatedAttempt = db.getSettlementAttemptByClaimId(claimId);
    if (updatedAttempt.transfer_2_status === 'completed' && updatedAttempt.transfer_3_status !== 'completed') {
      try {
        console.log(`🔄 Recovering Transfer 3 for claim ${claimId}...`);
        
        // Use idempotency key: claimId-transfer-3
        const idempotencyKey = `${claimId}-transfer-3`;
        
        const transfer3Result = await CircleService.createTransfer({
          fromWalletId: attempt.escrow_wallet_id,
          toWalletId: attempt.revenue_wallet_id,
          amount: attempt.revenue_amount,
          currency: 'USDC',
          claimId: claimId,
          description: `Platform fee recovery for claim ${claimId}`,
          idempotencyKey: idempotencyKey
        });

        if (transfer3Result.success) {
          // Update attempt record
          db.updateSettlementAttempt(claimId, {
            transfer_3_status: 'completed',
            transfer_3_circle_id: transfer3Result.transferId,
            transfer_3_id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            completed_at: new Date().toISOString()
          });

          // Also record in circle_transfers table
          db.createCircleTransfer({
            id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            claim_id: claimId,
            from_wallet_id: attempt.escrow_wallet_id,
            to_wallet_id: attempt.revenue_wallet_id,
            amount: attempt.revenue_amount,
            currency: 'USDC',
            circle_transfer_id: transfer3Result.transferId,
            status: transfer3Result.status || 'completed'
          });

          recovered.push({
            transfer: 'transfer_3',
            amount: attempt.revenue_amount,
            circleTransferId: transfer3Result.transferId
          });
          console.log(`✅ Transfer 3 recovered: ${transfer3Result.transferId}`);
        } else {
          errors.push({
            transfer: 'transfer_3',
            error: transfer3Result.error
          });
          db.updateSettlementAttempt(claimId, {
            transfer_3_status: 'failed',
            error_message: `Recovery failed: ${transfer3Result.error}`
          });
        }
      } catch (error) {
        errors.push({
          transfer: 'transfer_3',
          error: error.message
        });
        db.updateSettlementAttempt(claimId, {
          transfer_3_status: 'failed',
          error_message: `Recovery error: ${error.message}`
        });
      }
    }

    // Update recovery attempt counter
    const finalAttempt = db.getSettlementAttemptByClaimId(claimId);
    db.updateSettlementAttempt(claimId, {
      recovery_attempts: (finalAttempt.recovery_attempts || 0) + 1,
      last_recovery_attempt: new Date().toISOString()
    });

    const allCompleted = finalAttempt.transfer_1_status === 'completed' &&
                         finalAttempt.transfer_2_status === 'completed' &&
                         finalAttempt.transfer_3_status === 'completed';

    return {
      success: allCompleted && errors.length === 0,
      recovered: recovered,
      errors: errors.length > 0 ? errors : undefined,
      message: allCompleted 
        ? 'Settlement fully recovered'
        : `Partially recovered: ${recovered.length} transfers succeeded, ${errors.length} failed`
    };

  } catch (error) {
    console.error(`❌ Escrow recovery error for claim ${claimId}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to recover stuck escrow'
    };
  }
}

/**
 * Find and recover all stuck escrows (scheduled job)
 * 
 * @param {number} olderThanHours - Only recover attempts older than N hours (default: 1)
 * @returns {Promise<{found: number, recovered: number, errors: Array}>}
 */
async function recoverAllStuckEscrows(olderThanHours = 1) {
  try {
    const stuckEscrows = db.getStuckEscrows(olderThanHours);
    
    console.log(`🔍 Found ${stuckEscrows.length} stuck escrows (older than ${olderThanHours} hour(s))`);

    let recovered = 0;
    const errors = [];

    for (const attempt of stuckEscrows) {
      try {
        const result = await recoverStuckEscrow(attempt.claim_id);
        if (result.success) {
          recovered++;
        } else {
          errors.push({
            claimId: attempt.claim_id,
            error: result.error
          });
        }
      } catch (error) {
        errors.push({
          claimId: attempt.claim_id,
          error: error.message
        });
      }
    }

    return {
      found: stuckEscrows.length,
      recovered: recovered,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error) {
    console.error('❌ Error in recoverAllStuckEscrows:', error);
    return {
      found: 0,
      recovered: 0,
      errors: [{ error: error.message }]
    };
  }
}

module.exports = {
  recoverStuckEscrow,
  recoverAllStuckEscrows
};
