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

  const v8 = evaluateTurn({
    utterance: 'I need to pay my copay',
    tenantPolicy: { billing_enabled: true },
    sessionState: {
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      opqrst_resume_field: 'provocation',
      pending_intent_queue: []
    }
  });
  assert(v8.mode === 'tenant_billing', `V8 expected tenant_billing, got ${v8.mode}`);
  const { applyPivotToSession } = require('../services/conversation-mode/pivot-engine');
  const merged = applyPivotToSession(
    { conversation_mode: 'tenant_inbound_clinical', active_subrail: 'opqrst', opqrst_resume_field: 'provocation' },
    v8
  );
  assert(merged.opqrst_resume_field === 'provocation', 'V8 expected opqrst_resume_field preserved');

  console.log('✅ V8 clinical→billing pivot preserves opqrst_resume_field');

  process.env.OPQRST_FIELD_GATE_ENABLED = '1';
  const OpqrstFieldGate = require('../services/opqrst-field-gate');
  const v9 = OpqrstFieldGate.resolve({
    triageRow: {
      onset: 'yesterday',
      provocation: null,
      quality: null,
      severity: null,
      timing: null
    },
    userMessage: 'ok I finished paying',
    lastAssistantText: '',
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    opqrstResumeField: 'provocation',
    locale: 'en'
  });
  assert(v9.openField === 'provocation', `V9 expected provocation resume, got ${v9.openField}`);
  assert(v9.active, 'V9 expected gate active after return-to-clinical');
  assert(v9.shouldScriptVoice, 'V9 expected shouldScriptVoice on resume field');
  console.log('✅ V9 return-to-clinical resumes open opqrst field');

  console.log('\n✅ tenant-billing-pivot-smoke passed');
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
