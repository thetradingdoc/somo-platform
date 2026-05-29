'use strict';

const db = require('../database');
const {
  isTrialSimEnabledForCustomer,
  getTrialMinutesRemaining,
  isTrialAccessAllowed,
  canStartTrial,
  convertTrialToPaid
} = require('../services/trial-lifecycle');

describe('trial-lifecycle', () => {
  const customerId = `cust_trial_test_${Date.now()}`;

  beforeAll(() => {
    process.env.TRIAL_SIM_FLOW_ENABLED = '1';
    process.env.TRIAL_SIM_LAUNCH_AT = '2020-01-01T00:00:00Z';
    db.createCustomer({
      id: customerId,
      name: 'Trial Test',
      email: `trial-${Date.now()}@example.com`,
      phone_number: '+15555550199',
      customer_type: 'saas',
      status: 'active',
      email_verified: true
    });
    db.updateCustomer(customerId, {
      customer_type: 'saas',
      trial_status: 'active',
      trial_started_at: new Date().toISOString(),
      trial_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      phone_verified: 1
    });
    db.allocateFreeCredits(customerId, 60);
  });

  test('isTrialSimEnabledForCustomer for saas', () => {
    const c = db.getCustomer(customerId);
    expect(isTrialSimEnabledForCustomer(c)).toBe(true);
  });

  test('getTrialMinutesRemaining uses usage_events', () => {
    const c = db.getCustomer(customerId);
    const before = getTrialMinutesRemaining(db, c);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  test('isTrialAccessAllowed when active and not expired', () => {
    const c = db.getCustomer(customerId);
    expect(isTrialAccessAllowed(db, c)).toBe(true);
  });

  test('canStartTrial blocks duplicate phone', () => {
    const gate = canStartTrial(db, customerId, '+15555550199');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('trial_already_active');
  });

  test('convertTrialToPaid', () => {
    convertTrialToPaid(db, customerId);
    const c = db.getCustomer(customerId);
    expect(c.trial_status).toBe('converted');
  });
});
