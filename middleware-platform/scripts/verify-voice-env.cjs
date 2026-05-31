#!/usr/bin/env node
'use strict';

/**
 * Voice env checklist (D1-04, D4-03).
 * Usage: node scripts/verify-voice-env.cjs
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const checks = [
  { key: 'TWILIO_ACCOUNT_SID', required: true },
  { key: 'TWILIO_AUTH_TOKEN', required: true },
  { key: 'RETELL_API_KEY', required: true },
  {
    key: 'RETELL_LLM_WEBSOCKET_URL',
    required: false,
    hint: 'staging: wss://api.myskinandcare.com/webhook/retell/llm'
  },
  { key: 'RETELL_WEBHOOK_SECRET', required: false },
  { key: 'API_BASE_URL', required: false, hint: 'or NGROK_URL for local inbound' },
  { key: 'NGROK_URL', required: false },
  { key: 'DB_PATH', required: false },
  { key: 'SOMO_OWNER_EMAIL', required: false, hint: 'Week 1 owner bootstrap' },
  { key: 'EMAIL_FROM_NAME', required: false, hint: 'defaults to Somo in trial emails' }
];

let failed = 0;

console.log('\nSomo voice environment check\n');

for (const c of checks) {
  const val = (process.env[c.key] || '').trim();
  const ok = Boolean(val);
  const mark = ok ? '✅' : c.required ? '❌' : '⚠️ ';
  console.log(`  ${mark} ${c.key}: ${ok ? '(set)' : '(missing)'}${c.hint ? ` — ${c.hint}` : ''}`);
  if (c.required && !ok) failed++;
}

const publicUrl = (process.env.NGROK_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
if (publicUrl) {
  console.log(`\n  Public voice webhook base: ${publicUrl}/voice/incoming?customer_id=<OWNER_ID>`);
} else {
  console.log('\n  ⚠️  Set NGROK_URL or API_BASE_URL for Twilio inbound webhooks');
}

console.log('');
if (failed) {
  console.error(`❌ ${failed} required voice variable(s) missing.\n`);
  process.exit(1);
}
console.log('✅ Required voice variables present.\n');
