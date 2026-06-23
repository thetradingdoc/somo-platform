#!/usr/bin/env node
/**
 * Voice outbound + credit trace verification.
 * Usage:
 *   node scripts/voice/voice-outbound-verification.cjs           # local smoke only
 *   node scripts/voice/voice-outbound-verification.cjs --live <phone>  # prod outbound call
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execSync } = require('child_process');
const db = require('../../database');
const { getOperatorCustomerId } = require('../../services/voice/voice-account-resolution');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function snapshotCredits(customerId) {
  const credits = db.getCustomerCredits(customerId);
  const recent = db.db.prepare(`
    SELECT call_id, minutes_applied, source, direction, created_at
    FROM usage_events WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(customerId);
  return { credits, recent_usage_events: recent };
}

async function main() {
  const liveIdx = process.argv.indexOf('--live');
  const phone = liveIdx >= 0 ? process.argv[liveIdx + 1] : null;
  const operatorId = getOperatorCustomerId();

  console.log('=== Voice Outbound Verification ===');
  console.log(`Operator customer: ${operatorId || '(not set)'}`);

  console.log('\n[1/4] Running voice-billing-e2e-smoke...');
  run('node scripts/voice/voice-billing-e2e-smoke.cjs');
  console.log('✅ smoke passed');

  if (operatorId) {
    console.log('\n[2/4] Pre-call credit snapshot');
    console.log(JSON.stringify(snapshotCredits(operatorId), null, 2));
  }

  if (phone) {
    console.log(`\n[3/4] Initiating live outbound to ${phone}...`);
    const out = run(`node scripts/make-outbound-call.js ${phone}`);
    console.log(out);
    console.log('\nWait for call to complete, then re-run with --trace <twilio_sid_or_retell_call_id>');
  } else {
    console.log('\n[3/4] Skipping live call (pass --live <phone> to initiate)');
  }

  const traceIdx = process.argv.indexOf('--trace');
  if (traceIdx >= 0 && operatorId) {
    const callId = process.argv[traceIdx + 1];
    console.log(`\n[4/4] Tracing call ${callId}...`);
    const usage = db.db.prepare(`
      SELECT * FROM usage_events WHERE call_id = ? OR call_sid = ?
    `).all(callId, callId);
    const vcl = db.db.prepare(`
      SELECT call_id, customer_id, direction, call_duration_minutes, credits_deducted, status
      FROM voice_call_log WHERE call_id = ? OR twilio_call_sid = ? ORDER BY created_at DESC LIMIT 3
    `).all(callId, callId);
    const llm = db.db.prepare(`
      SELECT call_id, customer_id, operation, tokens_in, tokens_out, latency_ms
      FROM llm_usage_log WHERE call_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(callId);
    console.log(JSON.stringify({ usage_events: usage, voice_call_log: vcl, llm_usage_log: llm }, null, 2));
    console.log('\nPost-call credits:');
    console.log(JSON.stringify(snapshotCredits(operatorId), null, 2));
  } else if (!phone) {
    console.log('\n[4/4] Pass --trace <call_id> after a live call to print ledger proof');
  }

  try {
    const rev = run('gcloud run services describe somo-middleware --region=us-central1 --format="value(status.traffic[0].revisionName)" 2>/dev/null || echo unknown');
    console.log(`\nCloud Run revision: ${rev}`);
  } catch (_) {
    console.log('\nCloud Run revision: (gcloud not available)');
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
