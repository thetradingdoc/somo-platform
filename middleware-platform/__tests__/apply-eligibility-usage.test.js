'use strict';

jest.mock('../services/eligibility-usage-service', () => ({
  trackEligibilityUsage: jest.fn(() => ({ tracked: true })),
  checkDailyCap: jest.fn(() => ({ allowed: true, usage: { checks_today: 1 } }))
}));

const { checkDailyCap } = require('../services/eligibility-usage-service');
const { applyEligibilityUsage } = require('../services/apply-eligibility-usage');

describe('apply-eligibility-usage', () => {
  const db = {
    getCustomer: jest.fn(() => ({ plan_tier: 'practice', billing_enforcement_paused: 0 })),
    getEligibilityUsageEventById: jest.fn(),
    getMonthlyEligibilityUsage: jest.fn(() => ({ used: 0, overage: 0 })),
    trackMonthlyEligibilityUsage: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLING_ENFORCEMENT_PAUSED;
    checkDailyCap.mockReturnValue({ allowed: true, usage: { checks_today: 1 } });
  });

  test('blocks when daily cap reached', () => {
    checkDailyCap.mockReturnValue({
      allowed: false,
      code: 'DAILY_CAP_REACHED',
      message: 'cap'
    });
    const r = applyEligibilityUsage(db, { customerId: 'c1', eventId: 'e1', payerId: 'p1' });
    expect(r.success).toBe(false);
    expect(r.code).toBe('DAILY_CAP_REACHED');
  });

  test('records usage and increments monthly counter', () => {
    const r = applyEligibilityUsage(db, { customerId: 'c1', eventId: 'e2', payerId: 'p1', quality: 'full' });
    expect(r.success).toBe(true);
    expect(db.trackMonthlyEligibilityUsage).toHaveBeenCalled();
  });
});
