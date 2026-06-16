#!/usr/bin/env node
/**
 * Tenant billing pivot smoke (V6–V7 from conversation mode matrix).
 * Runs resolver/pivot assertions without telephony.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const { evaluateTurn } = require('../services/conversation-mode/pivot-engine');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const v6 = evaluateTurn({
    utterance: 'I want to pay my copay',
    tenantPolicy: { billing_enabled: true },
    sessionState: { conversation_mode: 'tenant_inbound_admin', pending_intent_queue: [] }
  });
  assert(v6.mode === 'tenant_billing', `V6 expected tenant_billing, got ${v6.mode}`);
  assert(v6.subrail === 'copay_link', `V6 expected copay_link subrail, got ${v6.subrail}`);
  console.log('✅ V6 admin billing pivot same turn');

  const v7 = evaluateTurn({
    utterance: 'pay copay and reschedule',
    tenantPolicy: { billing_enabled: true },
    sessionState: { conversation_mode: 'tenant_inbound_admin', pending_intent_queue: [] }
  });
  assert(v7.mode === 'tenant_billing', `V7 expected tenant_billing, got ${v7.mode}`);
  assert(
    Array.isArray(v7.pending_intents) && v7.pending_intents.includes('reschedule'),
    'V7 expected reschedule in pending_intents'
  );
  console.log('✅ V7 multi-intent billing primary keeps reschedule pending');

  console.log('\n✅ tenant-billing-pivot-smoke passed');
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
