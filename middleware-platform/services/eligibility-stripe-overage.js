'use strict';

const { getEligibilityOverageRate } = require('./plan-catalog');

/**
 * Day 60+ eligibility overage — invoice line item skeleton (pilot logs only when STRIPE_ELIG_OVERAGE=0).
 */
async function billEligibilityOverageForCustomer(customerId, opts = {}) {
  const db = require('../database');
  const customer = db.getCustomer?.(customerId);
  if (!customer) return { billed: false, reason: 'customer_not_found' };

  const billingMonth = opts.billingMonth || new Date().toISOString().slice(0, 7);
  const usage = db.getMonthlyEligibilityUsage?.(customerId, billingMonth) || { used: 0, overage: 0 };
  const overageChecks = usage.overage || 0;
  if (overageChecks <= 0) {
    return { billed: false, reason: 'no_overage', usage };
  }

  const rate = getEligibilityOverageRate(customer.plan_tier || 'practice');
  const amountUsd = Math.round(overageChecks * rate * 100) / 100;

  if (process.env.STRIPE_ELIG_OVERAGE !== '1') {
    console.log(JSON.stringify({
      component: 'eligibility_stripe_overage',
      event: 'overage_logged_not_billed',
      customer_id: customerId,
      overage_checks: overageChecks,
      amount_usd: amountUsd
    }));
    return { billed: false, reason: 'pilot_log_only', overage_checks: overageChecks, amount_usd: amountUsd };
  }

  const stripeConfig = require('../utils/stripe-config');
  const stripe = stripeConfig.initializeStripe?.();
  if (!stripe || !customer.stripe_customer_id) {
    return { billed: false, reason: 'stripe_not_configured', amount_usd: amountUsd };
  }

  try {
    await stripe.invoiceItems.create({
      customer: customer.stripe_customer_id,
      amount: Math.round(amountUsd * 100),
      currency: 'usd',
      description: `Eligibility overage — ${overageChecks} checks @ $${rate.toFixed(2)}`
    });
    return { billed: true, overage_checks: overageChecks, amount_usd: amountUsd };
  } catch (e) {
    console.warn('[eligibility-stripe-overage] invoice item failed:', e.message);
    return { billed: false, reason: e.message, amount_usd: amountUsd };
  }
}

module.exports = { billEligibilityOverageForCustomer };
