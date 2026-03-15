#!/usr/bin/env node
/**
 * Task 49: Mid-call payment failure recovery
 *
 * Run when create_checkout or verify_checkout_code fails during a voice call.
 *
 * Usage:
 *   node scripts/recovery-payment-failure.js --call-id <call_id>
 *   node scripts/recovery-payment-failure.js --payment-token <token> --action resend-code
 *
 * Recovery actions:
 *   1. create_checkout failed (missing email): Agent should ask for email and retry
 *   2. verify_checkout_code failed (wrong code): Agent should ask caller to re-read code and retry
 *   3. Resend verification code: POST /voice/checkout/resend-code (if implemented)
 *
 * The voice agent handlers now return voice_agent_instruction on failure to guide retry.
 * This script documents the recovery flow and can be extended for manual recovery.
 */

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const callId = getArg('--call-id');
const paymentToken = getArg('--payment-token');
const action = getArg('--action') || 'info';

const API_BASE = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';

async function main() {
  console.log('📋 Payment failure recovery');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!callId && !paymentToken) {
    console.log('Usage:');
    console.log('  node scripts/recovery-payment-failure.js --call-id <call_id>');
    console.log('  node scripts/recovery-payment-failure.js --payment-token <token> --action resend-code');
    console.log('\nRecovery guidance:');
    console.log('  • create_checkout fails (no email): Ask caller for email, retry with customer_email');
    console.log('  • verify_checkout_code fails: Ask caller to re-read 6-digit code, retry');
    console.log('  • Agent receives voice_agent_instruction in error response for retry steps');
    process.exit(0);
  }

  if (paymentToken && action === 'resend-code') {
    try {
      const res = await fetch(`${API_BASE}/voice/checkout/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_token: paymentToken })
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        console.log('✅ Verification code resent');
      } else {
        console.log('❌ Resend failed:', data.error || res.statusText);
      }
    } catch (e) {
      console.log('❌ Resend endpoint may not exist. Agent can retry verify_checkout_code with correct code.');
    }
  } else {
    console.log('ℹ️  Use voice_agent_instruction from failed responses to guide caller retry.');
  }
}

main().catch(console.error);
