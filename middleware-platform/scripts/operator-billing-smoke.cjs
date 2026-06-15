#!/usr/bin/env node
/**
 * Operator billing smoke — no telephony. Proves applyUsage against operator customer.
 *
 * Usage:
 *   STAGING_DB_PATH=./backups/middleware-staging.db node scripts/operator-billing-smoke.cjs
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbPath = process.env.STAGING_DB_PATH || process.env.DB_PATH;
if (!dbPath) {
  console.error('Set STAGING_DB_PATH or DB_PATH');
  process.exit(1);
}
process.env.DB_PATH = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
process.chdir(path.join(__dirname, '..'));
delete require.cache[require.resolve('../database')];

const db = require('../database');
const { applyUsage } = require('../services/apply-usage');
const { getOperatorCustomerId } = require('../services/voice-account-resolution');
const { v4: uuidv4 } = require('uuid');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const operatorId = getOperatorCustomerId();
  assert(operatorId, 'CALLSOMO_OPERATOR_CUSTOMER_ID not set');

  const customer = db.getCustomer(operatorId);
  assert(customer, `operator customer ${operatorId} not in DB`);

  const creditsBefore = db.getCustomerCredits(operatorId);
  assert(creditsBefore, `customer_credits missing for ${operatorId}`);

  const callId = `operator_billing_smoke_${Date.now()}`;
  const twilioSid = `CA_smoke_${uuidv4().slice(0, 8)}`;

  db.db
    .prepare(
      `INSERT INTO voice_call_log (id, call_id, twilio_call_sid, customer_id, direction, status, created_at)
       VALUES (?, ?, ?, ?, 'outbound', 'completed', datetime('now'))`
    )
    .run(uuidv4(), callId, twilioSid, operatorId);

  const result = applyUsage(db, {
    customerId: operatorId,
    callId,
    callSid: twilioSid,
    durationMinutes: 2,
    source: 'operator_billing_smoke',
    direction: 'outbound'
  });

  assert(result.success, `applyUsage failed: ${result.error || 'unknown'}`);

  const event = db.getUsageEventByCallId(callId);
  assert(event, 'usage_events row missing');
  assert(event.customer_id === operatorId, 'usage_events customer_id mismatch');

  if (customer.billing_enforcement_paused === 1) {
    assert(result.enforcement_paused === true, 'expected enforcement_paused meter path');
    assert(event.minutes_applied === 0, 'meter-only should not deduct minutes');
  } else {
    assert(result.minutes_applied > 0, 'expected minute deduction');
  }

  db.db.prepare('DELETE FROM usage_events WHERE call_id = ?').run(callId);
  db.db.prepare('DELETE FROM voice_call_log WHERE call_id = ?').run(callId);

  console.log('✅ operator-billing-smoke passed');
  console.log(JSON.stringify({ operatorId, callId, minutes_applied: result.minutes_applied }, null, 2));
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
