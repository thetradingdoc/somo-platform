#!/usr/bin/env node
/**
 * Extended voice billing + account resolution smoke tests.
 */
'use strict';

const db = require('../../database');
const { applyUsage, getTotalAvailableMinutes } = require('../../services/platform/apply-usage');
const { canAcceptInboundCall, canInitiateOutboundCall } = require('../../services/rcm/billing-access');
const { resolveCustomerIdForBilling } = require('../../services/voice/voice-account-resolution');
const { listTiers, listTopupPacks, hasOutboundFeature } = require('../../services/platform/plan-catalog');
const { getCapabilities, OPERATOR_CAPABILITIES } = require('../../services/platform/customer-capabilities');

const TEST_ID = `voice_billing_smoke_${Date.now()}`;
const { v4: uuidv4 } = require('uuid');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function setupCustomer(minutes = 5, extra = {}) {
  const id = TEST_ID;
  db.db.prepare(`
    INSERT OR REPLACE INTO customers (id, email, name, customer_type, subscription_status, plan_tier, email_verified)
    VALUES (?, ?, 'Smoke Test', ?, 'trialing', ?, 1)
  `).run(id, `${id}@example.com`, extra.customer_type || 'saas', extra.plan_tier || 'starter');

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
  assert(hasOutboundFeature('practice'), 'practice has outbound');

  const customerId = setupCustomer(3);
  try {
    const access = canAcceptInboundCall(db, customerId);
    assert(access.allowed, 'inbound allowed with minutes');

    const outboundDenied = canInitiateOutboundCall(db, customerId);
    assert(!outboundDenied.allowed && outboundDenied.reason === 'plan_no_outbound', 'starter blocks outbound');

    const r1 = applyUsage(db, {
      customerId,
      callId: 'call_smoke_1',
      durationMinutes: 2,
      source: 'test',
      direction: 'inbound'
    });
    assert(r1.minutes_applied === 2, 'first deduct');

    const event = db.getUsageEventByCallId('call_smoke_1');
    const cols = db.db.prepare('PRAGMA table_info(usage_events)').all().map((c) => c.name);
    if (cols.includes('direction')) {
      assert(event.direction === 'inbound', 'direction persisted');
    }

    const billingId = resolveCustomerIdForBilling(db, { clinic_id: 'lead_fake_123', customer_id: null });
    assert(billingId === null, 'lead_id clinic does not bill');

    const op = setupCustomer(100, { customer_type: 'operator', plan_tier: 'practice' });
    db.updateCustomer(op, {
      customer_type: 'operator',
      billing_enforcement_paused: 1
    });
    const opCaps = getCapabilities(db.getCustomer(op));
    assert(opCaps.includes('platform.leads'), 'operator capabilities');
    const opOutbound = canInitiateOutboundCall(db, op);
    assert(opOutbound.allowed, 'operator outbound allowed');
    cleanup(op);

    console.log('✅ voice-billing-e2e-smoke passed');
  } finally {
    cleanup(customerId);
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
