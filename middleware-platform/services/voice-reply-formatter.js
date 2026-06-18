'use strict';

const { isOpqrstEsPackActive } = require('./kelly-rails/config');
const {
  getOpqrstHintForClinicalLane,
  getNextQuestion
} = require('./clinical-opqrst-registry');

const MAX_VOICE_WORDS = parseInt(process.env.KELLY_VOICE_MAX_REPLY_WORDS || '25', 10);
const MAX_VOICE_QUESTIONS = 1;

function clampVoiceReply(text, _locale = 'en') {
  let out = String(text || '').trim();
  if (!out) return out;

  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > MAX_VOICE_WORDS) {
    out = words.slice(0, MAX_VOICE_WORDS).join(' ');
    if (!/[.!?]$/.test(out)) out += '.';
  }

  const parts = out.split(/(?<=[.!?])\s+/);
  let questions = 0;
  const kept = [];
  for (const p of parts) {
    const q = (p.match(/\?/g) || []).length;
    if (q && questions >= MAX_VOICE_QUESTIONS) {
      kept.push(p.replace(/\?+/g, '.').trim());
      continue;
    }
    if (q) questions += q;
    kept.push(p);
  }
  return kept.join(' ').trim();
}

/**
 * Prefer approved OPQRST registry line on voice clinical lane when pack active.
 */
function applyClinicalOpqrstVoiceLine(reply, state = {}) {
  const locale = state.locale || 'en';
  if (state.active_lane !== 'clinical' || state.channel !== 'voice') {
    return reply;
  }
  if (locale === 'es' && !isOpqrstEsPackActive()) {
    return reply;
  }
  const hint = getOpqrstHintForClinicalLane(state, locale);
  if (!hint) return reply;
  const scripted = getNextQuestion(locale, hint.stepId, hint.specialty);
  if (scripted?.text) return scripted.text;
  return reply;
}

function formatVoiceReply(reply, state = {}) {
  const stickyLocale = state.flags?.preferred_language || state.preferred_language;
  const effectiveState = stickyLocale ? { ...state, locale: stickyLocale } : state;
  let text = applyClinicalOpqrstVoiceLine(reply, effectiveState);
  text = clampVoiceReply(text, effectiveState.locale || 'en');
  return text;
}

module.exports = {
  clampVoiceReply,
  applyClinicalOpqrstVoiceLine,
  formatVoiceReply
};
