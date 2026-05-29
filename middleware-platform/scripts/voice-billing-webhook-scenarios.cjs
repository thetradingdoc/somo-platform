#!/usr/bin/env node
/**
 * In-process webhook scenario tests (T3.x) without Stripe CLI.
 * Usage: node scripts/voice-billing-webhook-scenarios.cjs
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const { handleVoiceBillingStripeEvent } = require('../services/voice-billing-stripe');
const { canAcceptInboundCall } = require('../services/billing-access');

const CUST = 'voice_webhook_test_customer';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function seedCustomer() {
  db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(CUST);
  db.db.prepare(`
    INSERT INTO customers (id, email, name, customer_type, subscription_status, plan_tier, email_verified)
    VALUES (?, ?, 'Webhook Test', 'saas', 'trialing', 'starter', 1)
  `).run(CUST, `${CUST}@test.local`);
  db.db.prepare(`
    INSERT INTO customer_credits (id, customer_id, credits_balance_minutes, topup_balance_minutes)
    VALUES (?, ?, 50, 0)
  `).run(uuidv4(), CUST);
}

async function testTopup() {
  const r = await handleVoiceBillingStripeEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        mode: 'payment',
        metadata: { customer_id: CUST, type: 'voice_topup', pack_id: 'standard' }
      }
    }
  });
  assert(r.handled && r.minutes === 180, 'T3.3 topup');
  const credits = db.db.prepare('SELECT topup_balance_minutes FROM customer_credits WHERE customer_id = ?').get(CUST);
  assert(credits.topup_balance_minutes === 180, 'topup balance');
  console.log('  ✓ T3.3');
}

async function testSubscriptionDeleted() {
  const subId = 'sub_test_' + Date.now();
  db.updateCustomerSubscriptionFields(CUST, { stripe_subscription_id: subId, subscription_status: 'active' });
  const r = await handleVoiceBillingStripeEvent({
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: subId,
        status: 'canceled',
        metadata: { customer_id: CUST }
      }
    }
  });
  assert(r.handled, 'T3.5 handled');
  const c = db.getCustomer(CUST);
  assert(c.subscription_status === 'canceled', 'canceled status');
  const gate = canAcceptInboundCall(db, CUST);
  assert(!gate.allowed, 'inbound blocked after cancel');
  console.log('  ✓ T3.5');
}

async function testPastDue() {
  db.updateCustomerSubscriptionFields(CUST, { subscription_status: 'active', past_due_since: null });
  const subId = 'sub_pd_' + Date.now();
  const r = await handleVoiceBillingStripeEvent({
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: subId,
        status: 'past_due',
        metadata: { customer_id: CUST }
      }
    }
  });
  assert(r.handled, 'T3.6 handled');
  const c = db.getCustomer(CUST);
  assert(c.subscription_status === 'past_due', 'past_due in DB');
  const gate = canAcceptInboundCall(db, CUST);
  assert(gate.allowed, 'T3.6 grace: still allowed');
  console.log('  ✓ T3.6');
}

async function testInvoicePaid() {
  if (!process.env.STRIPE_PRICE_STARTER) {
    console.log('  ⊘ T3.1/T3.2 skip (STRIPE_PRICE_STARTER not set)');
    return;
  }
  const subId = 'sub_inv_' + Date.now();
  const r = await handleVoiceBillingStripeEvent({
    type: 'invoice.paid',
    data: {
      object: {
        subscription: subId,
        customer: null,
        metadata: { customer_id: CUST, plan_tier: 'starter' },
        lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] }
      }
    }
  });
  assert(r.handled, 'T3.1 invoice.paid');
  const c = db.getCustomer(CUST);
  assert(c.subscription_status === 'active', 'active after invoice');
  assert(c.included_minutes_per_cycle === 300, '300 min granted');
  console.log('  ✓ T3.1');
}

async function main() {
  seedCustomer();
  const pass = [];
  const fail = [];
  for (const [name, fn] of [
    ['topup', testTopup],
    ['sub_deleted', testSubscriptionDeleted],
    ['past_due', testPastDue],
    ['invoice', testInvoicePaid]
  ]) {
    try {
      await fn();
      pass.push(name);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      fail.push({ name, error: e.message });
    }
    seedCustomer();
  }
  db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(CUST);
  console.log(JSON.stringify({ pass, fail }, null, 2));
  process.exit(fail.length ? 1 : 0);
}

main();
