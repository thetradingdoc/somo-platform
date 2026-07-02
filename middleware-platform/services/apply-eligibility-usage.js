'use strict';

const { getIncludedEligibilityChecks, getEligibilityOverageRate } = require('./plan-catalog');
const { trackEligibilityUsage, checkDailyCap } = require('./eligibility-usage-service');

/**
 * Idempotent eligibility check metering (Phase 2B).
 */
function applyEligibilityUsage(db, { customerId, eventId, payerId, quality, source = 'stedi' } = {}) {
  if (!customerId) return { success: false, error: 'customerId required' };
  const idKey =
    eventId ||
    `elig:${customerId}:${payerId || 'unknown'}:${new Date().toISOString().slice(0, 10)}`;
  if (db.getEligibilityUsageEventById?.(idKey)) {
    return { success: true, duplicate: true };
  }

  const customer = db.getCustomer?.(customerId);
  const enforcementPaused =
    process.env.BILLING_ENFORCEMENT_PAUSED === '1' || customer?.billing_enforcement_paused === 1;

  if (!enforcementPaused) {
    const cap = checkDailyCap(customerId);
    if (!cap.allowed) {
      return { success: false, error: cap.message, code: cap.code };
    }
  }

  trackEligibilityUsage({
    customerId,
    payerId,
    quality,
    source,
    sessionId: idKey
  });

  const tierId = customer?.plan_tier || 'practice';
  const allowance = getIncludedEligibilityChecks(tierId);
  const billingMonth = new Date().toISOString().slice(0, 7);
  const usage = db.getMonthlyEligibilityUsage?.(customerId, billingMonth) || { used: 0 };

  let overageForEvent = 0;
  if (usage.used >= allowance) overageForEvent = 1;

  if (db.trackMonthlyEligibilityUsage) {
    db.trackMonthlyEligibilityUsage(customerId, billingMonth, 1, overageForEvent);
  }

  try {
    const { checkEligibilityUsageAlert } = require('./eligibility-usage-alerts');
    checkEligibilityUsageAlert(customerId, tierId);
  } catch (_) {}

  return {
    success: true,
    overage: overageForEvent === 1,
    overage_rate: getEligibilityOverageRate(tierId),
    allowance,
    used: usage.used + 1
  };
}

module.exports = { applyEligibilityUsage };
