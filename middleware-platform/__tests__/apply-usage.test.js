'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { applyUsage, getTotalAvailableMinutes } = require('../services/apply-usage');
const { canAcceptInboundCall } = require('../services/billing-access');

const PREFIX = 'apply_usage_test_';

describe('applyUsage (pack-only)', () => {
  let customerId;

  beforeEach(() => {
    customerId = `${PREFIX}${Date.now()}`;
    db.db.prepare(`
      INSERT INTO customers (id, email, name, customer_type, subscription_status, plan_tier, email_verified)
      VALUES (?, ?, 'Test', 'saas', 'trialing', 'starter', 1)
    `).run(customerId, `${customerId}@test.local`);

    db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(customerId);
    db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(customerId);
    db.db.prepare(`
      INSERT INTO customer_credits (id, customer_id, credits_balance_minutes, topup_balance_minutes)
      VALUES (?, ?, 10, 0)
    `).run(uuidv4(), customerId);
  });

  afterEach(() => {
    db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(customerId);
    db.db.prepare('DELETE FROM monthly_usage WHERE customer_id = ?').run(customerId);
    db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(customerId);
    db.db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  });

  test('deducts minutes and is idempotent on same call_id', () => {
    const r1 = applyUsage(db, {
      customerId,
      callId: 'CA_dup_test',
      durationMinutes: 3,
      source: 'test'
    });
    expect(r1.minutes_applied).toBe(3);

    const r2 = applyUsage(db, {
      customerId,
      callId: 'CA_dup_test',
      durationMinutes: 3,
      source: 'test'
    });
    expect(r2.duplicate).toBe(true);
    expect(getTotalAvailableMinutes(db, customerId)).toBe(7);
  });

  test('does not go negative — partial apply when insufficient', () => {
    applyUsage(db, { customerId, callId: 'CA_exhaust', durationMinutes: 12, source: 'test' });
    expect(getTotalAvailableMinutes(db, customerId)).toBe(0);
    const gate = canAcceptInboundCall(db, customerId);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('no_minutes');
  });

  test('plan pool depletes before top-up bucket (T1.2)', () => {
    db.db.prepare(`
      UPDATE customer_credits
      SET credits_balance_minutes = 55, topup_balance_minutes = 50
      WHERE customer_id = ?
    `).run(customerId);

    const r = applyUsage(db, { customerId, callId: 'CA_plan_first', durationMinutes: 10, source: 'test' });
    expect(r.from_plan).toBe(5);
    expect(r.from_topup).toBe(5);
    expect(r.minutes_applied).toBe(10);

    const credits = db.db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);
    expect(credits.credits_balance_minutes).toBe(45);
    expect(credits.topup_balance_minutes).toBe(45);
  });

  test('zero balance writes usage_events with 0 applied (T1.3)', () => {
    db.db.prepare(`
      UPDATE customer_credits
      SET credits_balance_minutes = 0, topup_balance_minutes = 0
      WHERE customer_id = ?
    `).run(customerId);

    const r = applyUsage(db, { customerId, callId: 'CA_zero', durationMinutes: 5, source: 'test' });
    expect(r.minutes_applied).toBe(0);
    expect(r.minutes_shortfall).toBe(5);

    const evt = db.getUsageEventByCallId('CA_zero');
    expect(evt).toBeTruthy();
    expect(evt.minutes_applied).toBe(0);
    expect(getTotalAvailableMinutes(db, customerId)).toBe(0);
  });
});
