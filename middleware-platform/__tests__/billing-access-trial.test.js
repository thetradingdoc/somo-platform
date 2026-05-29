'use strict';

const db = require('../database');
const { canAcceptInboundCall, buildBlockedTwiml } = require('../services/billing-access');

describe('billing-access trial', () => {
  const customerId = `cust_gate_trial_${Date.now()}`;

  beforeAll(() => {
    process.env.TRIAL_SIM_FLOW_ENABLED = '1';
    process.env.TRIAL_SIM_LAUNCH_AT = '2020-01-01T00:00:00Z';
    db.createCustomer({
      id: customerId,
      name: 'Gate Trial',
      email: `gate-trial-${Date.now()}@example.com`,
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
    db.allocateFreeCredits(customerId, 10);
  });

  test('allows inbound for active trial with minutes', () => {
    const access = canAcceptInboundCall(db, customerId);
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe('trial_active');
  });

  test('blocks when trial expired', () => {
    db.updateCustomer(customerId, {
      trial_expires_at: new Date(Date.now() - 1000).toISOString()
    });
    const access = canAcceptInboundCall(db, customerId);
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('trial_expired');
    const twiml = buildBlockedTwiml(access.message);
    expect(twiml).toContain('paused');
  });
});
