/**
 * Instant Settlement Service
 * 
 * Implements the "Triple Jump" settlement flow:
 * 1. Insurer → Platform Escrow Wallet (100% of approved amount)
 * 2. Platform Escrow → Provider Wallet (97% - providerAmount)
 * 3. Platform Escrow → Revenue Wallet (3% - platform fee)
 * 
 * This enables DocLittle to:
 * - Hold funds in escrow for instant settlement
 * - Extract platform fee automatically
 * - Provide liquidity between insurer approval and provider payment
 */

const db = require('../database');
const CircleService = require('./circle-service');

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '3') / 100; // Default 3%

/**
 * Execute instant settlement with 3-way split (State Machine Implementation)
 * 
 * Uses durable state tracking via settlement_attempts table to enable recovery.
 * Idempotency keys prevent double-payment on retries.
 * 
 * @param {Object} params
 * @param {string} params.claimId - Claim ID
 * @param {number} params.totalApproved - Total approved amount from insurer
 * @param {string} params.insurerWalletId - Insurer's Circle wallet ID
 * @param {string} params.providerWalletId - Provider's Circle wallet ID
 * @param {string} [params.description] - Transfer description
 * @returns {Promise<{success: boolean, transfers: Array, revenueAmount: number, providerAmount: number, error?: string}>}
 */
async function executeInstantSettlement({
  claimId,
  totalApproved,
  insurerWalletId,
  providerWalletId,
  description
}) {
  try {
    // Step 1: Get or create platform wallets
    const escrowAccount = db.getCircleAccountByEntity('platform', 'escrow');
    const revenueAccount = db.getCircleAccountByEntity('platform', 'revenue');

    if (!escrowAccount || !escrowAccount.circle_wallet_id) {
      return {
        success: false,
        error: 'Platform escrow wallet not found. Create it first via POST /api/circle/wallets with entityType=platform, entityId=escrow'
      };
    }

    if (!revenueAccount || !revenueAccount.circle_wallet_id) {
      return {
        success: false,
        error: 'Platform revenue wallet not found. Create it first via POST /api/circle/wallets with entityType=platform, entityId=revenue'
      };
    }

    const escrowWalletId = escrowAccount.circle_wallet_id;
    const revenueWalletId = revenueAccount.circle_wallet_id;

    // Step 2: Calculate split amounts
    const revenueAmount = Math.round(totalApproved * PLATFORM_FEE_PERCENT * 100) / 100;
    const providerAmount = Math.round((totalApproved - revenueAmount) * 100) / 100;

    console.log(`💰 Instant Settlement for claim ${claimId}:`);
    console.log(`   Total Approved: $${totalApproved.toFixed(2)}`);
    console.log(`   Provider Amount (97%): $${providerAmount.toFixed(2)}`);
    console.log(`   Platform Fee (3%): $${revenueAmount.toFixed(2)}`);

    // Step 3: Check for existing settlement attempt (recovery scenario)
    let attempt = db.getSettlementAttemptByClaimId(claimId);
    const isRetry = !!attempt;

    if (!attempt) {
      // Create settlement attempt record BEFORE starting transfers (durable state)
      const attemptId = `settlement-${claimId}-${Date.now()}`;
      attempt = {
        id: attemptId,
        claim_id: claimId,
        total_approved: totalApproved,
        provider_amount: providerAmount,
        revenue_amount: revenueAmount,
        insurer_wallet_id: insurerWalletId,
        escrow_wallet_id: escrowWalletId,
        provider_wallet_id: providerWalletId,
        revenue_wallet_id: revenueWalletId,
        transfer_1_status: 'pending',
        transfer_2_status: 'pending',
        transfer_3_status: 'pending'
      };
      db.createSettlementAttempt(attempt);
      console.log(`📋 Created settlement attempt record: ${attemptId}`);
    } else {
      console.log(`🔄 Resuming existing settlement attempt for claim ${claimId}`);
    }

    const transfers = [];

    // Step 4: Transfer 1 - Insurer → Platform Escrow (100%)
    if (attempt.transfer_1_status !== 'completed') {
      // Use idempotency key: claimId-transfer-1 (prevents double-payment on retry)
      const idempotencyKey = `${claimId}-transfer-1`;
      
      const transfer1Result = await CircleService.createTransfer({
        fromWalletId: insurerWalletId,
        toWalletId: escrowWalletId,
        amount: totalApproved,
        currency: 'USDC',
        claimId: claimId,
        description: description || `Settlement for claim ${claimId} - Insurer to Escrow`,
        idempotencyKey: idempotencyKey
      });

      if (!transfer1Result.success) {
        db.updateSettlementAttempt(claimId, {
          transfer_1_status: 'failed',
          error_message: `Transfer 1 failed: ${transfer1Result.error}`
        });
        return {
          success: false,
          error: `Failed to transfer from insurer to escrow: ${transfer1Result.error}`,
          transfers: []
        };
      }

      // Update state BEFORE proceeding (durable checkpoint)
      db.updateSettlementAttempt(claimId, {
        transfer_1_status: 'completed',
        transfer_1_circle_id: transfer1Result.transferId,
        transfer_1_id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      });

      // Also record in circle_transfers table
      db.createCircleTransfer({
        id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        claim_id: claimId,
        from_wallet_id: insurerWalletId,
        to_wallet_id: escrowWalletId,
        amount: totalApproved,
        currency: 'USDC',
        circle_transfer_id: transfer1Result.transferId,
        status: transfer1Result.status || 'completed'
      });

      transfers.push({
        type: 'insurer_to_escrow',
        amount: totalApproved,
        circleTransferId: transfer1Result.transferId,
        status: 'completed'
      });
      console.log(`✅ Transfer 1 (Insurer → Escrow): ${transfer1Result.transferId}`);
    } else {
      console.log(`⏭️  Transfer 1 already completed: ${attempt.transfer_1_circle_id}`);
      transfers.push({
        type: 'insurer_to_escrow',
        amount: totalApproved,
        circleTransferId: attempt.transfer_1_circle_id,
        status: 'completed'
      });
    }

    // Reload attempt to get latest state
    attempt = db.getSettlementAttemptByClaimId(claimId);

    // Step 5: Transfer 2 & 3 - Split from Escrow (can run in parallel)
    const transferPromises = [];
    const transferTypes = [];

    // Transfer 2: Escrow → Provider (97%)
    if (attempt.transfer_2_status !== 'completed') {
      const idempotencyKey = `${claimId}-transfer-2`;
      transferPromises.push(
        CircleService.createTransfer({
          fromWalletId: escrowWalletId,
          toWalletId: providerWalletId,
          amount: providerAmount,
          currency: 'USDC',
          claimId: claimId,
          description: `Provider payment for claim ${claimId}`,
          idempotencyKey: idempotencyKey
        })
      );
      transferTypes.push(2);
    }

    // Transfer 3: Escrow → Revenue (3%)
    if (attempt.transfer_3_status !== 'completed') {
      const idempotencyKey = `${claimId}-transfer-3`;
      transferPromises.push(
        CircleService.createTransfer({
          fromWalletId: escrowWalletId,
          toWalletId: revenueWalletId,
          amount: revenueAmount,
          currency: 'USDC',
          claimId: claimId,
          description: `Platform fee for claim ${claimId}`,
          idempotencyKey: idempotencyKey
        })
      );
      transferTypes.push(3);
    }

    // Execute remaining transfers in parallel
    const transferResults = transferPromises.length > 0 
      ? await Promise.allSettled(transferPromises)
      : [];

    // Process Transfer 2
    if (attempt.transfer_2_status !== 'completed') {
      const transfer2Index = transferTypes.indexOf(2);
      const transfer2Result = transfer2Index >= 0 ? transferResults[transfer2Index] : null;

      if (transfer2Result && transfer2Result.status === 'fulfilled' && transfer2Result.value.success) {
        const result = transfer2Result.value;
        db.updateSettlementAttempt(claimId, {
          transfer_2_status: 'completed',
          transfer_2_circle_id: result.transferId,
          transfer_2_id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        });

        db.createCircleTransfer({
          id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          claim_id: claimId,
          from_wallet_id: escrowWalletId,
          to_wallet_id: providerWalletId,
          amount: providerAmount,
          currency: 'USDC',
          circle_transfer_id: result.transferId,
          status: result.status || 'completed'
        });

        transfers.push({
          type: 'escrow_to_provider',
          amount: providerAmount,
          circleTransferId: result.transferId,
          status: 'completed'
        });
        console.log(`✅ Transfer 2 (Escrow → Provider): ${result.transferId}`);
      } else {
        const error = transfer2Result?.status === 'rejected'
          ? transfer2Result.reason?.message || 'Unknown error'
          : transfer2Result?.value?.error || 'Transfer failed';
        db.updateSettlementAttempt(claimId, {
          transfer_2_status: 'failed',
          error_message: `Transfer 2 failed: ${error}`
        });
        transfers.push({
          type: 'escrow_to_provider',
          amount: providerAmount,
          error: error,
          status: 'failed'
        });
        console.error(`❌ Transfer 2 (Escrow → Provider) failed: ${error}`);
      }
    } else {
      console.log(`⏭️  Transfer 2 already completed: ${attempt.transfer_2_circle_id}`);
      transfers.push({
        type: 'escrow_to_provider',
        amount: providerAmount,
        circleTransferId: attempt.transfer_2_circle_id,
        status: 'completed'
      });
    }

    // Process Transfer 3
    if (attempt.transfer_3_status !== 'completed') {
      const transfer3Index = transferTypes.indexOf(3);
      const transfer3Result = transfer3Index >= 0 ? transferResults[transfer3Index] : null;

      if (transfer3Result && transfer3Result.status === 'fulfilled' && transfer3Result.value.success) {
        const result = transfer3Result.value;
        db.updateSettlementAttempt(claimId, {
          transfer_3_status: 'completed',
          transfer_3_circle_id: result.transferId,
          transfer_3_id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          completed_at: new Date().toISOString()
        });

        db.createCircleTransfer({
          id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          claim_id: claimId,
          from_wallet_id: escrowWalletId,
          to_wallet_id: revenueWalletId,
          amount: revenueAmount,
          currency: 'USDC',
          circle_transfer_id: result.transferId,
          status: result.status || 'completed'
        });

        transfers.push({
          type: 'escrow_to_revenue',
          amount: revenueAmount,
          circleTransferId: result.transferId,
          status: 'completed'
        });
        console.log(`✅ Transfer 3 (Escrow → Revenue): ${result.transferId}`);
      } else {
        const error = transfer3Result?.status === 'rejected'
          ? transfer3Result.reason?.message || 'Unknown error'
          : transfer3Result?.value?.error || 'Transfer failed';
        db.updateSettlementAttempt(claimId, {
          transfer_3_status: 'failed',
          error_message: `Transfer 3 failed: ${error}`
        });
        transfers.push({
          type: 'escrow_to_revenue',
          amount: revenueAmount,
          error: error,
          status: 'failed'
        });
        console.error(`❌ Transfer 3 (Escrow → Revenue) failed: ${error}`);
      }
    } else {
      console.log(`⏭️  Transfer 3 already completed: ${attempt.transfer_3_circle_id}`);
      transfers.push({
        type: 'escrow_to_revenue',
        amount: revenueAmount,
        circleTransferId: attempt.transfer_3_circle_id,
        status: 'completed'
      });
    }

    // Final state check
    const finalAttempt = db.getSettlementAttemptByClaimId(claimId);
    const allSucceeded = finalAttempt.transfer_1_status === 'completed' &&
                         finalAttempt.transfer_2_status === 'completed' &&
                         finalAttempt.transfer_3_status === 'completed';
    
    return {
      success: allSucceeded,
      transfers: transfers,
      revenueAmount: revenueAmount,
      providerAmount: providerAmount,
      totalApproved: totalApproved,
      platformFeePercent: PLATFORM_FEE_PERCENT * 100,
      message: allSucceeded 
        ? 'Instant settlement completed successfully'
        : 'Settlement partially completed - some transfers failed. Use recovery endpoint to retry.',
      settlementAttemptId: finalAttempt.id,
      state: {
        transfer_1_status: finalAttempt.transfer_1_status,
        transfer_2_status: finalAttempt.transfer_2_status,
        transfer_3_status: finalAttempt.transfer_3_status
      }
    };

  } catch (error) {
    console.error('❌ Instant settlement error:', error);
    
    // Update attempt with error if it exists
    try {
      const attempt = db.getSettlementAttemptByClaimId(claimId);
      if (attempt) {
        db.updateSettlementAttempt(claimId, {
          error_message: `Settlement error: ${error.message}`
        });
      }
    } catch (_) {}
    
    return {
      success: false,
      error: error.message || 'Failed to execute instant settlement',
      transfers: []
    };
  }
}

/**
 * Get platform wallets (escrow + revenue)
 * Creates them if they don't exist (requires CircleService to be available)
 * 
 * @returns {Promise<{escrow: Object|null, revenue: Object|null}>}
 */
async function ensurePlatformWallets() {
  const escrowAccount = db.getCircleAccountByEntity('platform', 'escrow');
  const revenueAccount = db.getCircleAccountByEntity('platform', 'revenue');

  // If wallets don't exist and CircleService is available, create them
  if ((!escrowAccount || !revenueAccount) && CircleService.isAvailable()) {
    const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
    if (!walletSetId) {
      console.warn('⚠️  CIRCLE_WALLET_SET_ID not set - cannot auto-create platform wallets');
      return { escrow: escrowAccount, revenue: revenueAccount };
    }

    // Create escrow wallet if missing
    if (!escrowAccount) {
      try {
        const escrowResult = await CircleService.createWallet({
          walletSetId: walletSetId,
          entityType: 'platform',
          entityId: 'escrow',
          description: 'Platform Escrow/Liquidity Vault'
        });
        if (escrowResult.success) {
          const accountId = `circle-account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          db.createCircleAccount({
            id: accountId,
            entity_type: 'platform',
            entity_id: 'escrow',
            circle_wallet_id: escrowResult.walletId,
            currency: 'USDC',
            status: 'active',
            merchant_id: null // Platform wallets don't belong to a merchant
          });
          console.log(`✅ Created platform escrow wallet: ${escrowResult.walletId}`);
        }
      } catch (e) {
        console.warn('⚠️  Failed to create escrow wallet:', e.message);
      }
    }

    // Create revenue wallet if missing
    if (!revenueAccount) {
      try {
        const revenueResult = await CircleService.createWallet({
          walletSetId: walletSetId,
          entityType: 'platform',
          entityId: 'revenue',
          description: 'DocLittle Revenue Account'
        });
        if (revenueResult.success) {
          const accountId = `circle-account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          db.createCircleAccount({
            id: accountId,
            entity_type: 'platform',
            entity_id: 'revenue',
            circle_wallet_id: revenueResult.walletId,
            currency: 'USDC',
            status: 'active',
            merchant_id: null // Platform wallets don't belong to a merchant
          });
          console.log(`✅ Created platform revenue wallet: ${revenueResult.walletId}`);
        }
      } catch (e) {
        console.warn('⚠️  Failed to create revenue wallet:', e.message);
      }
    }
  }

  return {
    escrow: escrowAccount || db.getCircleAccountByEntity('platform', 'escrow'),
    revenue: revenueAccount || db.getCircleAccountByEntity('platform', 'revenue')
  };
}

module.exports = {
  executeInstantSettlement,
  ensurePlatformWallets,
  PLATFORM_FEE_PERCENT
};
