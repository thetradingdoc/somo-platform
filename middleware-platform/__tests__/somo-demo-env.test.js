'use strict';

describe('somo-demo-env', () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
    jest.resetModules();
  });

  test('prefers SOMO_DEMO_ENABLED over legacy', () => {
    process.env.SOMO_DEMO_ENABLED = '0';
    process.env.DODGECALL_DEMO_ENABLED = '1';
    const env = require('../lib/somo-demo-env');
    expect(env.isDemoEnabled()).toBe(false);
  });

  test('falls back to DODGECALL_DEMO_ENABLED when SOMO unset', () => {
    delete process.env.SOMO_DEMO_ENABLED;
    process.env.DODGECALL_DEMO_ENABLED = '0';
    const env = require('../lib/somo-demo-env');
    expect(env.isDemoEnabled()).toBe(false);
  });

  test('reads caps from SOMO_DEMO_* with legacy fallback', () => {
    delete process.env.SOMO_DEMO_DAILY_CAP;
    process.env.DODGECALL_DEMO_DAILY_CAP = '42';
    const env = require('../lib/somo-demo-env');
    expect(env.getDailyCap()).toBe(42);
  });
});
