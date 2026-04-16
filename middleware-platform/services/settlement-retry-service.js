'use strict';

const db = require('../database');
const { executeInstantSettlement } = require('./instant-settlement-service');

const MAX_RETRIES = Math.max(0, parseInt(process.env.SETTLEMENT_RETRY_MAX_ATTEMPTS || '8', 10) || 8);
const BASE_MS = Math.max(1000, parseInt(process.env.SETTLEMENT_RETRY_BASE_MS || '60000', 10) || 60000);
const MAX_BACKOFF_MS = Math.max(
  BASE_MS,
  parseInt(process.env.SETTLEMENT_RETRY_MAX_BACKOFF_MS || `${60 * 60 * 1000}`, 10) || 60 * 60 * 1000
);

function computeBackoffMs(attemptIndex) {
  const exp = Math.min(10, Math.max(0, attemptIndex));
  const raw = BASE_MS * Math.pow(2, exp);
  return Math.min(raw, MAX_BACKOFF_MS);
}

function isoFromNow(ms) {
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Retry failed instant-settlement attempts with exponential backoff; dead-letter after MAX_RETRIES.
 */
async function processDueRetries() {
  const attempts = db.listSettlementAttemptsForRetry() || [];
  const summary = { processed: 0, succeeded: 0, scheduled: 0, dead_lettered: 0, errors: [] };

  for (const att of attempts) {
    const claimId = att.claim_id;
    if (!claimId) continue;

    const recovery = Number(att.recovery_attempts || 0) || 0;
    if (MAX_RETRIES > 0 && recovery >= MAX_RETRIES) {
      try {
        const dup = db.db
          .prepare(`SELECT id FROM settlement_dead_letter_queue WHERE claim_id = ? LIMIT 1`)
          .get(claimId);
        if (!dup) {
          db.updateSettlementAttempt(claimId, {
            dead_letter_at: new Date().toISOString()
          });
          db.insertSettlementDeadLetter({
            claim_id: claimId,
            settlement_attempt_id: att.id,
            reason: 'max_retries_exceeded',
            error_summary: att.error_message || 'Settlement retries exhausted',
            metadata: { recovery_attempts: recovery, max_retries: MAX_RETRIES }
          });
        } else {
          db.updateSettlementAttempt(claimId, {
            dead_letter_at: new Date().toISOString()
          });
        }
      } catch (e) {
        summary.errors.push({ claimId, error: e.message });
      }
      summary.dead_lettered += 1;
      continue;
    }

    summary.processed += 1;

    try {
      const result = await executeInstantSettlement({
        claimId,
        totalApproved: Number(att.total_approved || 0),
        insurerWalletId: att.insurer_wallet_id,
        providerWalletId: att.provider_wallet_id,
        description: `Retry settlement claim ${claimId}`
      });

      if (result.success) {
        summary.succeeded += 1;
        db.updateSettlementAttempt(claimId, {
          next_settlement_retry_at: null
        });
        continue;
      }

      const nextAttempt = recovery + 1;
      const delay = computeBackoffMs(nextAttempt);
      db.updateSettlementAttempt(claimId, {
        recovery_attempts: nextAttempt,
        last_recovery_attempt: new Date().toISOString(),
        next_settlement_retry_at: isoFromNow(delay),
        error_message: result.error || att.error_message || 'retry_failed'
      });
      summary.scheduled += 1;
    } catch (e) {
      const nextAttempt = recovery + 1;
      const delay = computeBackoffMs(nextAttempt);
      try {
        db.updateSettlementAttempt(claimId, {
          recovery_attempts: nextAttempt,
          last_recovery_attempt: new Date().toISOString(),
          next_settlement_retry_at: isoFromNow(delay),
          error_message: e.message || 'retry_exception'
        });
      } catch (_) {}
      summary.errors.push({ claimId, error: e.message });
    }
  }

  return summary;
}

function getSettlementRetryPolicy() {
  return {
    max_retries: MAX_RETRIES,
    base_ms: BASE_MS,
    max_backoff_ms: MAX_BACKOFF_MS
  };
}

module.exports = {
  processDueRetries,
  computeBackoffMs,
  getSettlementRetryPolicy
};
