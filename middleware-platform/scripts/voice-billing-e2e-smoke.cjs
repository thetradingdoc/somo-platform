#!/usr/bin/env node
/**
 * Smoke checks for voice subscription billing (no Stripe/Twilio calls).
 * Usage: node scripts/voice-billing-e2e-smoke.cjs
 */

'use strict';

const db = require('../database');
const { applyUsage, getTotalAvailableMinutes } = require('../services/apply-usage');
const { canAcceptInboundCall, canProvisionNumber } = require('../services/billing-access');
const { listTiers, listTopupPacks } = require('../services/plan-catalog');

const TEST_ID = `voice_billing_smoke_${Date.now()}`;
const { v4: uuidv4 } = require('uuid');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function setupCustomer(minutes = 5) {
  const id = TEST_ID;
  db.db.prepare(`
    INSERT OR REPLACE INTO customers (id, email, name, customer_type, subscription_status, plan_tier, email_verified)
    VALUES (?, ?, 'Smoke Test', 'saas', 'trialing', 'starter', 1)
  `).run(id, `${id}@example.com`);

  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(id);
  db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(id);

  db.db.prepare(`
    INSERT INTO customer_credits (id, customer_id, credits_balance_minutes, topup_balance_minutes)
    VALUES (?, ?, ?, 0)
  `).run(uuidv4(), id, minutes);

  return id;
}

function cleanup(id) {
  try {
    db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(id);
    db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(id);
    db.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  } catch (e) {
    console.warn('[smoke] cleanup:', e.message);
  }
}

async function main() {
  assert(listTiers().length >= 3, 'catalog tiers');
  assert(listTopupPacks().length >= 3, 'catalog topups');

  const customerId = setupCustomer(3);
  try {
    const access = canAcceptInboundCall(db, customerId);
    assert(access.allowed, 'inbound allowed with minutes');

    const r1 = applyUsage(db, { customerId, callId: 'call_smoke_1', durationMinutes: 2, source: 'test' });
    assert(r1.minutes_applied === 2, 'first deduct');

    const r2 = applyUsage(db, { customerId, callId: 'call_smoke_1', durationMinutes: 2, source: 'test' });
    assert(r2.duplicate, 'idempotent duplicate');

    const provision = canProvisionNumber(db, customerId);
    assert(!provision.allowed, 'provision blocked without active sub');

    applyUsage(db, { customerId, callId: 'call_smoke_2', durationMinutes: 5, source: 'test' });
    const blocked = canAcceptInboundCall(db, customerId);
    assert(!blocked.allowed && blocked.reason === 'no_minutes', 'ingress blocked at zero');

    assert(getTotalAvailableMinutes(db, customerId) === 0, 'zero balance');

    console.log('✅ voice-billing-e2e-smoke passed');
  } finally {
    cleanup(customerId);
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
