'use strict';

const stripeConfig = require('../utils/stripe-config');

describe('stripe-config billing mode', () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  test('defaults to test billing mode', () => {
    delete process.env.STRIPE_BILLING_MODE;
    expect(stripeConfig.getStripeBillingMode()).toBe('test');
  });

  test('live mode reads STRIPE_LIVE_PRICE env keys', () => {
    process.env.STRIPE_LIVE_PRICE_STARTER = 'price_live_starter';
    const keys = stripeConfig.getStripePriceEnvKeys('live');
    expect(keys).toContain('STRIPE_LIVE_PRICE_STARTER');
  });

  test('test mode reads STRIPE_PRICE env keys', () => {
    const keys = stripeConfig.getStripePriceEnvKeys('test');
    expect(keys).toContain('STRIPE_PRICE_STARTER');
    expect(keys).not.toContain('STRIPE_LIVE_PRICE_STARTER');
  });
});
