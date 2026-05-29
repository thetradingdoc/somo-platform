#!/usr/bin/env node
/**
 * T5.1 / T5.2 low-balance alert debounce (in-process).
 */

'use strict';

const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const { applyUsage } = require('../services/apply-usage');
const { maybeSendLowBalanceAlert } = require('../services/voice-billing-alerts');

const CUST = 'voice_alert_test';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function seed(minutes) {
  db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(CUST);
  db.db.prepare(`
    INSERT INTO customers (id, email, name, customer_type, subscription_status, plan_tier,
      included_minutes_per_cycle, last_low_balance_alert_at, email_verified)
    VALUES (?, ?, 'Alert Test', 'saas', 'active', 'starter', 300, NULL, 1)
  `).run(CUST, `${CUST}@test.local`);
  db.db.prepare(`
    INSERT INTO customer_credits (id, customer_id, credits_balance_minutes, topup_balance_minutes)
    VALUES (?, ?, ?, 0)
  `).run(uuidv4(), CUST, minutes);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  seed(60);
  maybeSendLowBalanceAlert(CUST);
  await sleep(500);
  const c1 = db.getCustomer(CUST);
  assert(c1.last_low_balance_alert_at, 'T5.1 alert timestamp set');

  maybeSendLowBalanceAlert(CUST);
  await sleep(200);
  const c2 = db.getCustomer(CUST);
  assert(c1.last_low_balance_alert_at === c2.last_low_balance_alert_at, 'T5.2 no duplicate within 24h');
  console.log('  ✓ T5.1');
  console.log('  ✓ T5.2');

  db.db.prepare('DELETE FROM usage_events WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(CUST);
  db.db.prepare('DELETE FROM customers WHERE id = ?').run(CUST);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
