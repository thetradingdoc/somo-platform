'use strict';

const db = require('../database');
const { ensureSignupTrialCredits, getSignupTrialMinutes } = require('../services/subscription-credits');
const { getSignupTrialMinutes: catalogMinutes } = require('../services/plan-catalog');

describe('subscription-credits (Phase 0 SSOT)', () => {
  test('getSignupTrialMinutes matches plan-catalog', () => {
    expect(getSignupTrialMinutes()).toBe(catalogMinutes());
    expect(getSignupTrialMinutes()).toBeGreaterThan(0);
  });

  test('ensureSignupTrialCredits seeds customer_credits once', () => {
    const customerId = `cust_credits_${Date.now()}`;
    db.createCustomer({
      id: customerId,
      name: 'Credits Test',
      email: `credits-${Date.now()}@example.com`,
      status: 'active',
      email_verified: 1
    });

    const first = ensureSignupTrialCredits(db, customerId);
    expect(first.seeded).toBe(true);
    expect(first.minutes).toBe(getSignupTrialMinutes());

    const credits = db.getCustomerCredits(customerId);
    expect(credits.credits_balance_minutes).toBe(getSignupTrialMinutes());

    const second = ensureSignupTrialCredits(db, customerId);
    expect(second.seeded).toBe(false);
  });
});
