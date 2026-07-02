/**
 * Subscription = agent credits — single wiring point between plan-catalog and customer_credits.
 * Trial signup minutes come from plan-catalog.signup_trial_minutes.
 * Paid cycle minutes are granted via voice-billing-stripe → grantSubscriptionCycleMinutes.
 */

const { getSignupTrialMinutes, getTier } = require('./plan-catalog');

/**
 * Seed signup trial credits when a tenant is provisioned without an existing credits row.
 * @returns {{ seeded: boolean, minutes?: number }}
 */
function ensureSignupTrialCredits(dbModule, customerId) {
  if (!customerId || !dbModule?.getCustomerCredits || !dbModule?.allocateFreeCredits) {
    return { seeded: false };
  }
  if (dbModule.getCustomerCredits(customerId)) {
    return { seeded: false };
  }
  const minutes = getSignupTrialMinutes();
  dbModule.allocateFreeCredits(customerId, minutes);
  return { seeded: true, minutes };
}

function tierIncludedMinutes(tierId) {
  return getTier(tierId).included_minutes_per_cycle ?? 0;
}

module.exports = {
  ensureSignupTrialCredits,
  tierIncludedMinutes,
  getSignupTrialMinutes
};
