#!/usr/bin/env node
/**
 * Manual voice DoD — automated multi-turn proof (no telephony).
 * Confirms provocation is stored once and not re-scripted on the next turn.
 *
 * Usage: OPQRST_FIELD_GATE_ENABLED=1 node scripts/opqrst/opqrst-voice-dod-smoke.cjs
 *        OPQRST_FIELD_GATE_ENABLED=1 node scripts/opqrst/opqrst-voice-dod-smoke.cjs --with-history
 */
'use strict';

process.env.OPQRST_FIELD_GATE_ENABLED = process.env.OPQRST_FIELD_GATE_ENABLED || '1';

const OpqrstFieldGate = require('../../services/clinical/opqrst-field-gate');
const { applyClinicalOpqrstVoiceLine } = require('../../services/voice/voice-reply-formatter');
const { applyPivotToSession } = require('../../services/conversation/pivot-engine');
const { PivotEvent } = require('../../services/conversation/pivot-events');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function countProvocation(text) {
  return (String(text || '').match(/better or worse|makes it better|makes it worse/gi) || []).length;
}

function main() {
  const withHistory = process.argv.includes('--with-history');
  if (withHistory) {
    runWithHistoryPath();
    return;
  }
  runResolvePath();
}

function runResolvePath() {
  const provAsk = 'What makes it better or worse?';
  const triageAfterOnset = { onset: '3 days ago', target_specialty: 'Primary Care' };

  // Turn 1: Kelly asks provocation; user answers.
  const t1 = OpqrstFieldGate.resolve({
    triageRow: triageAfterOnset,
    userMessage: 'rest helps',
    lastAssistantText: provAsk,
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    locale: 'en',
    channel: 'voice'
  });
  assert(t1.openField === 'provocation', 'turn1 openField=provocation');
  assert(t1.storePayload?.provocation === 'rest helps', 'turn1 stores provocation');
  assert(t1.userAnsweredOpenField, 'turn1 userAnsweredOpenField');

  const triageAfterProv = { ...triageAfterOnset, provocation: 'rest helps' };

  // Turn 2: same assistant line + user "ok" — must NOT re-script provocation.
  const t2 = OpqrstFieldGate.resolve({
    triageRow: triageAfterProv,
    userMessage: 'ok',
    lastAssistantText: provAsk,
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    locale: 'en'
  });
  assert(!t2.shouldScriptVoice || t2.openField !== 'provocation', 'turn2 no provocation re-script');
  assert(t2.userAnsweredOpenField || t2.openField !== 'provocation', 'turn2 provocation closed');

  const fmt2 = applyClinicalOpqrstVoiceLine('Thanks, noted.', {
    active_lane: 'clinical',
    channel: 'voice',
    locale: 'en',
    triageRow: triageAfterProv,
    last_user_message: 'ok',
    last_assistant_text: provAsk,
    _opqrst_gate: t2
  });
  assert(countProvocation(fmt2) === 0, `turn2 formatter must not repeat provocation: "${fmt2}"`);

  // Tangent during provocation — no store, no repeat.
  const t3 = OpqrstFieldGate.resolve({
    triageRow: triageAfterOnset,
    userMessage: 'Does insurance cover this?',
    lastAssistantText: provAsk,
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    locale: 'en'
  });
  assert(t3.userAskedTangent, 'tangent detected');
  assert(!t3.storePayload, 'tangent does not store');
  const fmt3 = applyClinicalOpqrstVoiceLine('Let me check coverage for you.', {
    active_lane: 'clinical',
    channel: 'voice',
    locale: 'en',
    _opqrst_gate: t3
  });
  assert(countProvocation(fmt3) === 0, 'tangent turn keeps LLM reply without provocation repeat');

  // Billing pivot preserves resume field; return opens provocation not complete loop.
  const pivoted = applyPivotToSession(
    {
      conversation_mode: 'tenant_inbound_clinical',
      active_subrail: 'opqrst',
      flags: { _opqrst_gate: { openField: 'provocation' } }
    },
    {
      mode: 'tenant_billing',
      subrail: 'copay_link',
      prior_mode: 'tenant_inbound_clinical',
      pivot_event: PivotEvent.BILLING_INTENT_DETECTED,
      pivot_reason: 'billing_pivot',
      pending_intents: []
    }
  );
  assert(pivoted.opqrst_resume_field === 'provocation', 'billing pivot preserves resume field');

  const t4 = OpqrstFieldGate.resolve({
    triageRow: triageAfterOnset,
    userMessage: 'done paying',
    lastAssistantText: '',
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    opqrstResumeField: 'provocation',
    locale: 'en'
  });
  assert(t4.openField === 'provocation', 'return-to-clinical resumes provocation once');
  assert(t4.shouldScriptVoice, 'return-to-clinical may script open field');

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'provocation_stored_turn1',
      'no_repeat_turn2',
      'formatter_no_repeat_turn2',
      'tangent_no_store_no_repeat',
      'billing_pivot_resume',
      'return_to_clinical_resume'
    ]
  }, null, 2));
}

function runWithHistoryPath() {
  const provAsk = 'What makes it better or worse?';
  const sessionId = 'dod-voice-history-smoke';
  const {
    appendHistory,
    getLastAssistantText
  } = require('../../services/kelly/rails/history');
  const { applyOpqrstFieldGate } = require('../../services/kelly/rails/execute-turn');

  appendHistory(sessionId, 'assistant', provAsk);

  const triageRow = { onset: '3 days ago', target_specialty: 'Primary Care' };
  let storedProvocation = null;
  const mockDb = {
    getTriageSession: () => ({ ...triageRow, provocation: storedProvocation })
  };

  const state = {
    active_lane: 'clinical',
    conversation_mode: 'tenant_inbound_clinical',
    active_subrail: 'opqrst',
    flags: {},
    locale: 'en'
  };

  (async () => {
    const gate1 = await applyOpqrstFieldGate(
      state,
      {
        sessionId,
        message: 'rest helps',
        clinicId: 'clinic-smoke',
        channel: 'voice'
      },
      mockDb
    );
    assert(gate1.storePayload?.provocation === 'rest helps', 'history path stores provocation');
    assert(
      getLastAssistantText(sessionId, {}) === provAsk,
      'Kelly history supplies lastAssistantText'
    );

    storedProvocation = 'rest helps';
    appendHistory(sessionId, 'user', 'rest helps');
    appendHistory(sessionId, 'assistant', 'Thanks, noted.');

    const gate2 = await applyOpqrstFieldGate(
      { ...state, flags: {} },
      { sessionId, message: 'ok', clinicId: 'clinic-smoke', channel: 'voice' },
      mockDb
    );
    assert(!gate2.shouldScriptVoice || gate2.openField !== 'provocation', 'turn2 no provocation loop');

    console.log(JSON.stringify({
      ok: true,
      mode: 'with-history',
      checks: ['kelly_history_last_assistant', 'provocation_stored_via_applyOpqrstFieldGate', 'no_repeat_turn2']
    }, null, 2));
  })().catch((e) => {
    console.error('❌ opqrst-voice-dod-smoke --with-history:', e.message);
    process.exit(1);
  });
}

try {
  main();
} catch (e) {
  console.error('❌ opqrst-voice-dod-smoke:', e.message);
  process.exit(1);
}
