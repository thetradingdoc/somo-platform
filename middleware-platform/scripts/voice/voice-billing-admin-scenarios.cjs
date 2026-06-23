#!/usr/bin/env node
/**
 * T6.1 / T6.2 admin enforcement pause/resume (in-process).
 */

'use strict';

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const { canAcceptInboundCall } = require('../../services/rcm/billing-access');

const CUST = 'voice_admin_pause_test';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function seed() {
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(CUST);
  db.db.prepare(`
    INSERT INTO customers (id, email, name, customer_type, subscription_status, billing_enforcement_paused, email_verified)
    VALUES (?, ?, 'Pause Test', 'saas', 'active', 0, 1)
  `).run(CUST, `${CUST}@test.local`);
  db.db.prepare(`
    INSERT INTO customer_credits (id, customer_id, credits_balance_minutes, topup_balance_minutes)
    VALUES (?, ?, 0, 0)
  `).run(uuidv4(), CUST);
}

function main() {
  seed();
  let gate = canAcceptInboundCall(db, CUST);
  assert(!gate.allowed && gate.reason === 'no_minutes', 'T6.1 pre: blocked');

  db.updateCustomerSubscriptionFields(CUST, {
    billing_enforcement_paused: 1,
    billing_enforcement_paused_reason: 'test'
  });
  gate = canAcceptInboundCall(db, CUST);
  assert(gate.allowed && gate.reason === 'enforcement_paused', 'T6.1 pause: allowed');
  console.log('  ✓ T6.1');

  db.updateCustomerSubscriptionFields(CUST, {
    billing_enforcement_paused: 0,
    billing_enforcement_paused_reason: null
  });
  gate = canAcceptInboundCall(db, CUST);
  assert(!gate.allowed, 'T6.2 resume: blocked again');
  console.log('  ✓ T6.2');

  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(CUST);
  console.log('Admin scenarios OK');
}

main();
