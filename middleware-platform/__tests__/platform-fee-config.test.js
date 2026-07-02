'use strict';

const {
  getCopayPlatformFeeFraction,
  getSettlementPlatformFeePercent,
  calculateCopayProviderPayoutCents
} = require('../services/platform-fee-config');

describe('platform-fee-config', () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  test('copay uses PLATFORM_FEE_PCT default 20%', () => {
    delete process.env.COPAY_PLATFORM_FEE_PCT;
    process.env.PLATFORM_FEE_PCT = '0.20';
    expect(getCopayPlatformFeeFraction()).toBe(0.2);
    expect(calculateCopayProviderPayoutCents(10000)).toBe(8000);
  });

  test('settlement uses SETTLEMENT_PLATFORM_FEE_PERCENT', () => {
    process.env.SETTLEMENT_PLATFORM_FEE_PERCENT = '3';
    expect(getSettlementPlatformFeePercent()).toBe(3);
  });
});
