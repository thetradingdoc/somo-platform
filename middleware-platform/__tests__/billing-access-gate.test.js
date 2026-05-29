'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { canAcceptInboundCall } = require('../services/billing-access');

const ID = 'billing_gate_jest';

function seed(overrides = {}) {
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(ID);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(ID);
  db.db.prepare(`
    INSERT INTO customers (id, email, name, customer_type, subscription_status, plan_tier, past_due_since, email_verified)
    VALUES (?, ?, 'Gate', 'saas', ?, 'starter', ?, 1)
  `).run(
    ID,
    `${ID}@test.local`,
    overrides.subscription_status || 'active',
    overrides.past_due_since ?? null
  );
  db.db.prepare(`
    INSERT INTO customer_credits (id, customer_id, credits_balance_minutes, topup_balance_minutes)
    VALUES (?, ?, ?, ?)
  `).run(
    uuidv4(),
    ID,
    overrides.credits_balance_minutes ?? 100,
    overrides.topup_balance_minutes ?? 0
  );
}

afterAll(() => {
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(ID);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(ID);
});

describe('billing-access inbound gate (T2.2–T2.4)', () => {
  test('T2.2 zero balance blocked', () => {
    seed({ credits_balance_minutes: 0, topup_balance_minutes: 0 });
    const g = canAcceptInboundCall(db, ID);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('no_minutes');
  });

  test('T2.3 past_due in grace allowed', () => {
    seed({
      subscription_status: 'past_due',
      past_due_since: new Date().toISOString(),
      credits_balance_minutes: 500
    });
    expect(canAcceptInboundCall(db, ID).allowed).toBe(true);
  });

  test('T2.3 past_due after grace blocked', () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    seed({
      subscription_status: 'past_due',
      past_due_since: fourDaysAgo,
      credits_balance_minutes: 500
    });
    const g = canAcceptInboundCall(db, ID);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('subscription_inactive');
  });

  test('T2.4 canceled blocked', () => {
    seed({ subscription_status: 'canceled', credits_balance_minutes: 500 });
    const g = canAcceptInboundCall(db, ID);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('subscription_inactive');
  });

  test('T6.1 enforcement pause allows zero balance', () => {
    seed({ credits_balance_minutes: 0, topup_balance_minutes: 0 });
    db.updateCustomerSubscriptionFields(ID, { billing_enforcement_paused: 1 });
    const g = canAcceptInboundCall(db, ID);
    expect(g.allowed).toBe(true);
    expect(g.reason).toBe('enforcement_paused');
    db.updateCustomerSubscriptionFields(ID, { billing_enforcement_paused: 0 });
  });
});
