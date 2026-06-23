#!/usr/bin/env node
/**
 * Phase C C-P0-04 — EN automated voice cohort (10 happy-path OPQRST scenarios).
 * Simulates gate + formatter paths without Retell telephony.
 *
 * Usage: node scripts/opqrst/opqrst-phase-c-en-cohort.cjs
 */
'use strict';

process.env.OPQRST_FIELD_GATE_ENABLED = '1';
process.env.KELLY_RAILS_V2 = '1';

const OpqrstFieldGate = require('../../services/clinical/opqrst-field-gate');
const { applyClinicalOpqrstVoiceLine } = require('../../services/voice/voice-reply-formatter');

const SCENARIOS = [
  { id: 'back_pain', specialty: 'Orthopedics', onset: '2 days ago', prov: 'walking worse', quality: 'sharp', severity: '6', timing: 'constant' },
  { id: 'rash', specialty: 'Dermatology', onset: 'yesterday', prov: 'scratching worse', quality: 'itchy', severity: '4', timing: 'comes and goes' },
  { id: 'chest_pain', specialty: 'Cardiology', onset: '1 hour ago', prov: 'exertion worse', quality: 'pressure', severity: '7', timing: 'constant' },
  { id: 'headache', specialty: 'Primary Care', onset: '3 days ago', prov: 'light worse', quality: 'throbbing', severity: '5', timing: 'comes and goes' },
  { id: 'anxiety', specialty: 'Psychiatry', onset: '2 weeks ago', prov: 'stress worse', quality: 'nervous', severity: '6', timing: 'constant' },
  { id: 'knee_pain', specialty: 'Orthopedics', onset: '1 week ago', prov: 'stairs worse', quality: 'dull', severity: '5', timing: 'constant' },
  { id: 'cough', specialty: 'Primary Care', onset: '4 days ago', prov: 'cold air worse', quality: 'dry', severity: '3', timing: 'comes and goes' },
  { id: 'abdominal', specialty: 'Primary Care', onset: 'today', prov: 'eating worse', quality: 'cramping', severity: '6', timing: 'constant' },
  { id: 'fatigue', specialty: 'Primary Care', onset: '1 month ago', prov: 'activity worse', quality: 'heavy', severity: '4', timing: 'constant' },
  { id: 'skin_spot', specialty: 'Dermatology', onset: '2 weeks ago', prov: 'sun worse', quality: 'rough', severity: '2', timing: 'constant' }
];

function provocationLoop(replyHistory) {
  let repeats = 0;
  for (let i = 1; i < replyHistory.length; i++) {
    const prev = replyHistory[i - 1] || '';
    const cur = replyHistory[i] || '';
    if (/better or worse/i.test(prev) && /better or worse/i.test(cur)) repeats++;
  }
  return repeats;
}

function runScenario(sc) {
  const triageRow = { onset: sc.onset, target_specialty: sc.specialty };
  const provAsk = 'What makes it better or worse?';
  const replies = [];

  const t1 = OpqrstFieldGate.resolve({
    triageRow,
    userMessage: sc.prov,
    lastAssistantText: provAsk,
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    specialty: sc.specialty,
    locale: 'en'
  });
  if (!t1.storePayload?.provocation) {
    return { id: sc.id, pass: false, reason: 'provocation not stored' };
  }

  triageRow.provocation = t1.storePayload.provocation;
  replies.push(provAsk);

  const t2 = OpqrstFieldGate.resolve({
    triageRow,
    userMessage: 'ok',
    lastAssistantText: provAsk,
    activeLane: 'clinical',
    conversationMode: 'tenant_inbound_clinical',
    activeSubrail: 'opqrst',
    triagePolicy: 'conditional',
    specialty: sc.specialty,
    locale: 'en'
  });

  const fmt = applyClinicalOpqrstVoiceLine('Got it.', {
    active_lane: 'clinical',
    channel: 'voice',
    locale: 'en',
    triageRow,
    _opqrst_gate: t2
  });
  replies.push(fmt);

  const loops = provocationLoop(replies);
  if (loops > 0) {
    return { id: sc.id, pass: false, reason: `provocation repeated ${loops}x`, replies };
  }
  if (/better or worse/i.test(fmt)) {
    return { id: sc.id, pass: false, reason: 'formatter repeated provocation after store', replies };
  }

  return { id: sc.id, pass: true, openFieldAfter: t2.openField };
}

function main() {
  const results = SCENARIOS.map(runScenario);
  const passed = results.filter((r) => r.pass).length;
  const out = {
    cohort: 'C-P0-04-en-automated',
    date: new Date().toISOString().slice(0, 10),
    total: SCENARIOS.length,
    passed,
    failed: SCENARIOS.length - passed,
    gate_enabled: true,
    results
  };
  console.log(JSON.stringify(out, null, 2));
  if (passed < SCENARIOS.length) process.exit(1);
}

main();
