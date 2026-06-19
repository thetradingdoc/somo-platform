#!/usr/bin/env node
'use strict';

/**
 * OPQRST FIELD GATE — STANDALONE TEST SUITE
 * Implements spec blocks: T-1, T-1b, T-2, T-3, T-6
 *
 * HOW TO RUN
 *   node scripts/opqrst-field-gate.standalone.test.js
 *   npm run test:opqrst-field-gate:standalone --prefix middleware-platform
 *
 * Uses production services/opqrst-field-gate.js (not a reference stub).
 * Assertions aligned to shipped gate behavior — see plan standalone_gate_test_prediction.
 */

process.env.OPQRST_FIELD_GATE_ENABLED = '1';

const assert = require('assert');
const path = require('path');

const gate = require(path.join(__dirname, '..', 'services', 'opqrst-field-gate'));

let passed = 0;
let failed = 0;
let currentBlock = '';
const failures = [];

function block(name) {
  currentBlock = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ block: currentBlock, name, error: err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

/** Only onset filled — provocation is next open field (matches Jest T-1b fixtures). */
const PROVOCATION_OPEN_ROW = {
  onset: '3 days ago'
};

/** All required fields filled; provocation optional — gate treats as complete (openField null). */
const COMPLETE_ROW_DEFAULT_POLICY = {
  onset: '3 days ago',
  quality: 'sharp pain',
  severity: '7',
  timing: 'comes and goes'
};

const PROVOCATION_SCRIPT_EN = 'What makes it better or worse?';

function baseOpts(overrides = {}) {
  return {
    triageRow: PROVOCATION_OPEN_ROW,
    lastAssistantText: PROVOCATION_SCRIPT_EN,
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    opqrstFrozen: false,
    triagePolicy: 'conditional',
    locale: 'en',
    ...overrides
  };
}

block('T-1 — core gate unit tests');

test('T-1.1: Provocation Q -> "rest helps" -> stores without symptom keyword', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'rest helps' }));
  assert.strictEqual(result.classification, 'answer');
  assert.strictEqual(result.userAnsweredOpenField, true);
  assert.deepStrictEqual(result.storePayload, { provocation: 'rest helps' });
  assert.strictEqual(result.shouldScriptVoice, false);
});

test('T-1.2: Provocation Q -> "what do you mean?" -> tangent, no store, no script', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'what do you mean?' }));
  assert.strictEqual(result.classification, 'tangent');
  assert.strictEqual(result.storePayload, null);
  assert.strictEqual(result.allowStoreOpqrst, false);
  assert.strictEqual(result.shouldScriptVoice, false);
});

test('T-1.3: Field already filled in triageRow -> no shouldScriptVoice', () => {
  const FULLY_FILLED_ROW = {
    onset: '3 days ago',
    quality: 'sharp pain',
    severity: '7',
    timing: 'comes and goes',
    provocation: 'rest helps',
    region: 'lower back'
  };
  const result = gate.resolve(baseOpts({
    triageRow: FULLY_FILLED_ROW,
    userMessage: 'anything'
  }));
  assert.strictEqual(result.openField, null);
  assert.strictEqual(result.shouldScriptVoice, false);
  assert.strictEqual(result.opqrstComplete, true);
});

test('T-1.3b: Required fields filled without provocation -> opqrstComplete, gate inactive for further fields', () => {
  const result = gate.resolve(baseOpts({
    triageRow: COMPLETE_ROW_DEFAULT_POLICY,
    userMessage: '',
    lastAssistantText: ''
  }));
  assert.strictEqual(result.opqrstComplete, true);
  assert.strictEqual(result.openField, null,
    'shipped gate: complete short-circuits before optional provocation prompt');
  assert.strictEqual(result.shouldScriptVoice, false);
});

test('T-1.4: Non-clinical lane -> gate inactive', () => {
  const result = gate.resolve(baseOpts({
    activeLane: 'booking',
    conversationMode: 'tenant_inbound_admin',
    activeSubrail: null,
    userMessage: 'rest helps'
  }));
  assert.strictEqual(result.active, false);
  assert.strictEqual(result.shouldScriptVoice, false);
  assert.strictEqual(result.allowStoreOpqrst, false);
});

block('T-1b — ambiguous / mixed utterance classification');

test('T-1b.1: Mixed question+answer -> extracts answer, does not loop', () => {
  const result = gate.resolve(baseOpts({
    userMessage: 'Will this go away on its own, or does walking make it worse?'
  }));
  assert.strictEqual(result.classification, 'answer');
  assert.ok(result.storePayload);
  assert.strictEqual(result.shouldScriptVoice, false);
});

test('T-1b.2: Uncertain answer -> stored as provocation, not re-asked', () => {
  const result = gate.resolve(baseOpts({
    userMessage: "I don't know, maybe when I sit down?"
  }));
  assert.strictEqual(result.classification, 'answer');
  assert.deepStrictEqual(result.storePayload, {
    provocation: "I don't know, maybe when I sit down?"
  });
  assert.strictEqual(result.shouldScriptVoice, false);
});

test('T-1b.3: Insurance question -> tangent', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'Does insurance cover this?' }));
  assert.strictEqual(result.classification, 'tangent');
  assert.strictEqual(result.storePayload, null);
});

test('T-1b.4: "It hurts when I walk — is that bad?" -> captures walk trigger', () => {
  const result = gate.resolve(baseOpts({
    userMessage: 'It hurts when I walk — is that bad?'
  }));
  assert.strictEqual(result.classification, 'answer');
  assert.ok(result.storePayload);
});

test('T-1b.5: "Nothing really" -> stored as answer', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'Nothing really' }));
  assert.strictEqual(result.classification, 'answer');
  assert.deepStrictEqual(result.storePayload, { provocation: 'Nothing really' });
});

test('T-1b.6: "Can I book after this?" -> tangent (booking intent)', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'Can I book after this?' }));
  assert.strictEqual(result.classification, 'tangent');
  assert.strictEqual(result.storePayload, null);
  assert.strictEqual(result.resumeFieldAfterTangent, 'provocation');
});

test('T-1b.7: "What?" -> pure meta-question tangent', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'What?' }));
  assert.strictEqual(result.classification, 'tangent');
  assert.strictEqual(result.storePayload, null);
});

test('T-1b.8: "Sitting helps but standing is worse I think" -> stored', () => {
  const result = gate.resolve(baseOpts({
    userMessage: 'Sitting helps but standing is worse I think'
  }));
  assert.strictEqual(result.classification, 'answer');
  assert.ok(result.storePayload?.provocation);
  assert.match(result.storePayload.provocation, /sitting helps/i);
});

test('T-1b.9: "Pay my copay first" -> tangent, resume field preserved', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'Pay my copay first' }));
  assert.strictEqual(result.classification, 'tangent');
  assert.strictEqual(result.storePayload, null);
  assert.strictEqual(result.resumeFieldAfterTangent, 'provocation');
});

test('T-1b.10: Empty / filler utterance -> no store, no forced re-ask via formatter', () => {
  const result = gate.resolve(baseOpts({ userMessage: 'uh-huh' }));
  assert.strictEqual(result.classification, 'ambiguous');
  assert.strictEqual(result.storePayload, null);
  assert.strictEqual(result.allowStoreOpqrst, false);
  assert.strictEqual(result.shouldScriptVoice, false);
});

block('T-2 — formatter passthrough vs script-on-allow');

test('T-2.1: Formatter passthrough on tangent (Kelly\'s real reply is kept)', () => {
  const kellyReply = 'Insurance usually covers a specialist visit after triage.';
  const result = gate.resolve(baseOpts({ userMessage: 'Does insurance cover this?' }));

  function formatVoiceReplySimulated(reply, gateResult) {
    if (gateResult.shouldScriptVoice && gateResult.scriptedLine) {
      return gateResult.scriptedLine;
    }
    return reply;
  }

  const finalReply = formatVoiceReplySimulated(kellyReply, result);
  assert.strictEqual(finalReply, kellyReply);
});

test('T-2.2: Empty user turn does not force script (LLM/execute-turn owns first prompt)', () => {
  const result = gate.resolve(baseOpts({ userMessage: '', lastAssistantText: '' }));
  assert.strictEqual(result.shouldScriptVoice, false);
  assert.strictEqual(result.openField, 'provocation');
});

test('T-2.3: Formatter scripts when gate shouldScriptVoice and scriptedLine set', () => {
  const result = gate.resolve(baseOpts({
    userMessage: 'hello there',
    lastAssistantText: '',
    triageRow: PROVOCATION_OPEN_ROW
  }));

  function formatVoiceReplySimulated(reply, gateResult) {
    if (gateResult.shouldScriptVoice && gateResult.scriptedLine) {
      return gateResult.scriptedLine;
    }
    return reply;
  }

  assert.strictEqual(result.shouldScriptVoice, true);
  assert.ok(result.scriptedLine);
  const finalReply = formatVoiceReplySimulated('', result);
  assert.strictEqual(finalReply, result.scriptedLine);
  assert.match(finalReply, /better or worse/i);
});

block('T-3 — pivot survival across rail switches');

test('T-3.1: Tangent toward billing preserves resume field', () => {
  const turn1 = gate.resolve(baseOpts({ userMessage: 'I need to pay my copay first' }));
  assert.strictEqual(turn1.classification, 'tangent');
  assert.strictEqual(turn1.resumeFieldAfterTangent, 'provocation');
});

test('T-3.2: On return to clinical, gate resumes the SAME field, not clinical_intake', () => {
  const returnTurn = gate.resolve(baseOpts({
    userMessage: '',
    lastAssistantText: '',
    opqrstResumeField: 'provocation',
    triageRow: PROVOCATION_OPEN_ROW
  }));
  assert.strictEqual(returnTurn.openField, 'provocation');
  assert.notStrictEqual(returnTurn.openField, 'onset');
});

test('T-3.3: After answering provocation post-pivot, field is captured (no re-ask)', () => {
  const result = gate.resolve(baseOpts({
    userMessage: 'walking makes it worse',
    opqrstResumeField: 'provocation',
    triageRow: PROVOCATION_OPEN_ROW
  }));
  assert.deepStrictEqual(result.storePayload, { provocation: 'walking makes it worse' });
  assert.strictEqual(result.shouldScriptVoice, false);
});

test('T-3.4: Full pivot sequence end-to-end produces no duplicate scripted question', () => {
  const step1 = gate.resolve(baseOpts({ userMessage: 'pay my copay' }));
  assert.strictEqual(step1.classification, 'tangent');

  const step3 = gate.resolve(baseOpts({
    userMessage: '',
    lastAssistantText: '',
    opqrstResumeField: step1.resumeFieldAfterTangent
  }));
  assert.strictEqual(step3.openField, 'provocation');

  const step4 = gate.resolve(baseOpts({
    userMessage: 'cold compress helps',
    opqrstResumeField: step1.resumeFieldAfterTangent
  }));
  assert.deepStrictEqual(step4.storePayload, { provocation: 'cold compress helps' });

  const step5 = gate.resolve(baseOpts({
    userMessage: 'anything else',
    triageRow: { onset: '3 days ago', quality: 'sharp', severity: 7, timing: 'constant', provocation: 'cold compress helps' }
  }));
  assert.notStrictEqual(step5.openField, 'provocation');
});

block('T-6 — idempotency (formatVoiceReply runs in node-runner AND retell-websocket)');

test('T-6.1: Calling resolve() twice with identical opts returns identical results', () => {
  const opts = baseOpts({ userMessage: 'rest helps' });
  const first = gate.resolve(opts);
  const second = gate.resolve(opts);
  assert.deepStrictEqual(first.storePayload, second.storePayload);
  assert.strictEqual(first.classification, second.classification);
  assert.strictEqual(first.shouldScriptVoice, second.shouldScriptVoice);
});

test('T-6.2: Second resolve when provocation already in triageRow does not re-store', () => {
  const opts = baseOpts({
    userMessage: 'rest helps',
    triageRow: { onset: '3 days ago', provocation: 'rest helps' }
  });
  const second = gate.resolve(opts);
  assert.strictEqual(second.storePayload, null);
  assert.notStrictEqual(second.openField, 'provocation');
});

test('T-6.3: After first store simulated in triageRow, second resolve is a no-op for store', () => {
  const opts = baseOpts({ userMessage: 'walking makes it worse' });
  const first = gate.resolve(opts);
  assert.ok(first.storePayload);

  const rowAfterStore = {
    onset: '3 days ago',
    provocation: first.storePayload.provocation
  };
  const second = gate.resolve({ ...opts, triageRow: rowAfterStore });
  assert.strictEqual(second.storePayload, null);
  assert.strictEqual(first.openField, 'provocation');
  assert.notStrictEqual(second.openField, 'provocation');
});

console.log('\n' + '='.repeat(70));
console.log(`\x1b[1mResults: ${passed} passed, ${failed} failed (${passed + failed} total)\x1b[0m`);

if (failed > 0) {
  console.log('\n\x1b[31mFailures:\x1b[0m');
  for (const f of failures) {
    console.log(`  [${f.block}] ${f.name}`);
    console.log(`    ${f.error.message}`);
  }
  console.log('\n' + '='.repeat(70));
  process.exitCode = 1;
} else {
  console.log('\n' + '='.repeat(70));
  console.log('\x1b[32mAll standalone gate tests pass against production opqrst-field-gate.js\x1b[0m');
  console.log('='.repeat(70));
}
