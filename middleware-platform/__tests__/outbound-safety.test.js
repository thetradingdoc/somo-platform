'use strict';

const { assertOutboundAllowed, isWithinQuietHours } = require('../services/outbound-quiet-hours');
const {
  checkOutboundRetryAllowed,
  getOutboundAttemptKey
} = require('../services/outbound-retry-policy');

describe('outbound quiet hours (LX-7)', () => {
  test('blocks outside default quiet window', () => {
    const settings = { outbound_quiet_hours: { start: '09:00', end: '17:00', timezone: 'UTC' } };
    const at3am = new Date('2026-06-18T03:00:00Z');
    expect(isWithinQuietHours(settings.outbound_quiet_hours, at3am)).toBe(false);
    expect(() => assertOutboundAllowed(settings, { now: at3am })).toThrow(/quiet hours/i);
  });
});

describe('outbound retry cap (LX-11)', () => {
  beforeEach(() => {
    process.env.OUTBOUND_MIN_RETRY_INTERVAL_MS = '0';
  });

  afterEach(() => {
    delete process.env.OUTBOUND_MIN_RETRY_INTERVAL_MS;
  });

  test('attempt key is stable per phone+customer', () => {
    const key = getOutboundAttemptKey({ phone_number: '+1 (555) 123-4567', customer_id: 'c1' });
    expect(key).toContain('c1');
    expect(key).toContain('1234567');
  });

  test('increments attempt count', () => {
    const Database = require('better-sqlite3');
    const dbMod = { db: new Database(':memory:') };
    const phone = '+1555' + String(Date.now()).slice(-7);
    const first = checkOutboundRetryAllowed(dbMod, { phone_number: phone, customer_id: 'c1' });
    expect(first.attempt).toBe(1);
    const second = checkOutboundRetryAllowed(dbMod, { phone_number: phone, customer_id: 'c1' });
    expect(second.attempt).toBe(2);
    dbMod.db.close();
  });
});
