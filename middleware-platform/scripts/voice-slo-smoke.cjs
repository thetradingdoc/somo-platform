#!/usr/bin/env node
'use strict';

/**
 * Smoke: voice SLO metrics increment in-process.
 */
process.chdir(require('path').join(__dirname, '..'));

const Metrics = require('../services/metrics');
const { recordVoiceAssistantTurn } = require('../services/voice-slo-metrics');

const sessionId = `voice_slo_smoke_${Date.now()}`;

recordVoiceAssistantTurn({
  sessionId,
  replyText: 'When did your symptoms start?',
  conversationHistory: []
});

recordVoiceAssistantTurn({
  sessionId,
  replyText: 'Thanks. What makes it better or worse?',
  conversationHistory: [{ role: 'assistant', content: 'When did your symptoms start?' }]
});

const all = Metrics.getAll();
const key = `voice.metrics.session.${sessionId}.assistant_turns`;
const turns = Number(all[key] || 0);

if (turns < 2) {
  console.error(`FAIL: expected >= 2 assistant turns, got ${turns}`);
  process.exit(1);
}

console.log(`OK voice SLO smoke session=${sessionId} assistant_turns=${turns}`);
