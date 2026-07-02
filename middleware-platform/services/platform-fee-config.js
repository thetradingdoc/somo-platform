'use strict';

/**
 * SSOT for platform take-rate — reconciles PLATFORM_FEE_PCT (Stripe webhook, 0–1)
 * vs legacy PLATFORM_FEE_PERCENT (settlement, whole percent).
 *
 * Copay/voice checkout uses COPAY_PLATFORM_FEE_PCT when set, else PLATFORM_FEE_PCT.
 * Instant settlement uses SETTLEMENT_PLATFORM_FEE_PERCENT (default 3%).
 */

function parseFraction(raw, fallback) {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getCopayPlatformFeeFraction() {
  if (process.env.COPAY_PLATFORM_FEE_PCT != null && process.env.COPAY_PLATFORM_FEE_PCT !== '') {
    return parseFraction(process.env.COPAY_PLATFORM_FEE_PCT, 0.2);
  }
  return parseFraction(process.env.PLATFORM_FEE_PCT, 0.2);
}

function getSettlementPlatformFeePercent() {
  return parseFraction(process.env.SETTLEMENT_PLATFORM_FEE_PERCENT ?? process.env.PLATFORM_FEE_PERCENT, 3);
}

function calculateCopayProviderPayoutCents(totalAmountCents) {
  const fee = Math.round(totalAmountCents * getCopayPlatformFeeFraction());
  return totalAmountCents - fee;
}

module.exports = {
  getCopayPlatformFeeFraction,
  getSettlementPlatformFeePercent,
  calculateCopayProviderPayoutCents
};
