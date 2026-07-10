'use strict';

const { primaryIntent } = require('./conversation-mode/intent-detector');
const { UserIntent } = require('./conversation-mode/conversation-mode-types');

const FAST_INTENTS = new Set([
  UserIntent.GENERAL,
  UserIntent.HANDOFF,
  UserIntent.APPT_LOOKUP
]);

const SLOW_INTENTS = new Set([
  UserIntent.SYMPTOM,
  UserIntent.PAY_COPAY,
  UserIntent.RECORDS,
  UserIntent.BILLING_FAQ
]);

function resolveVoiceFillerDelayMs(opts = {}) {
  const base = parseInt(process.env.KELLY_VOICE_FILLER_MS || '1200', 10) || 1200;
  const fastMs = parseInt(process.env.KELLY_VOICE_FILLER_FAST_MS || '600', 10) || 600;
  const slowMs = parseInt(process.env.KELLY_VOICE_FILLER_SLOW_MS || '1800', 10) || 1800;

  if (opts.heavyTurn === true || opts.expectRag === true) return slowMs;

  const message = String(opts.message || opts.userMessage || '').trim();
  if (message) {
    const intent = primaryIntent(message)?.intent;
    if (SLOW_INTENTS.has(intent)) return slowMs;
    if (FAST_INTENTS.has(intent)) return fastMs;
    if (intent === UserIntent.BOOK || intent === UserIntent.CANCEL || intent === UserIntent.RESCHEDULE) {
      return fastMs;
    }
  }

  const lane = String(opts.active_lane || opts.kelly_lane_hint || '').toLowerCase();
  if (/clinical|triage|payment|records|rag/.test(lane)) return slowMs;

  return base;
}

function resolveVoiceFillerText(locale) {
  const loc = String(locale || 'en').slice(0, 2).toLowerCase();
  const templates = {
    en: 'One moment please.',
    es: 'Un momento, por favor.',
    ru: 'Одну минуту, пожалуйста.',
    zh: '请稍等。'
  };
  return templates[loc] || templates.en;
}

module.exports = { resolveVoiceFillerDelayMs, resolveVoiceFillerText };
