'use strict';

/**
 * Voice-friendly PPO benefit readback from eligibility 271 result (EO-P1-1).
 */

function formatCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${n.toFixed(0)}`;
}

function buildPpoReadback(eligibilityResult = {}) {
  const parts = [];
  const plan = eligibilityResult.planSummary || eligibilityResult.plan_summary;
  if (plan) parts.push(String(plan));

  const copay = formatCurrency(eligibilityResult.copay ?? eligibilityResult.copay_amount);
  if (copay) parts.push(`copay ${copay}`);

  const dedRem = formatCurrency(
    eligibilityResult.deductibleRemaining ?? eligibilityResult.deductible_remaining
  );
  const dedTotal = formatCurrency(eligibilityResult.deductibleTotal ?? eligibilityResult.deductible_total);
  if (dedRem && dedTotal) {
    parts.push(`deductible ${dedRem} remaining of ${dedTotal}`);
  } else if (dedRem) {
    parts.push(`deductible ${dedRem} remaining`);
  }

  const coins = eligibilityResult.coinsurancePercent ?? eligibilityResult.coinsurance_percent;
  if (coins != null && Number(coins) > 0) {
    parts.push(`${Number(coins)}% coinsurance after deductible`);
  }

  if (!parts.length) {
    if (eligibilityResult.eligible === false) {
      return 'I could not confirm active PPO benefits for this member.';
    }
    if (eligibilityResult.eligibility_quality === 'thin') {
      return 'Your plan is active, but benefit details are limited — the front desk will confirm your copay.';
    }
    return null;
  }

  const summary = parts.join(', ');
  return `Your PPO benefits show ${summary}.`;
}

module.exports = { buildPpoReadback };
