'use strict';

const { isOpqrstEsPackActive, isOpqrstFieldGateEnabled } = require('./kelly-rails/config');
const {
  getOpqrstHintForClinicalLane,
  getNextQuestion
} = require('./clinical-opqrst-registry');
const OpqrstFieldGate = require('./opqrst-field-gate');
const Metrics = require('./metrics');

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

/** Legacy L4 step → registry scripted line (F-1 flag off). */
function applyClinicalOpqrstVoiceLineLegacy(reply, state = {}) {
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

/**
 * Gate-based OPQRST script override when flag on; legacy step mapping when flag off.
 */
function applyClinicalOpqrstVoiceLine(reply, state = {}) {
  if (!isOpqrstFieldGateEnabled()) {
    return applyClinicalOpqrstVoiceLineLegacy(reply, state);
  }

  const locale = state.locale || 'en';
  if (state.active_lane !== 'clinical' || state.channel !== 'voice') {
    return reply;
  }
  if (locale === 'es' && !isOpqrstEsPackActive()) {
    return reply;
  }

  const gateResult = state._opqrst_gate || state.flags?._opqrst_gate;
  if (gateResult) {
    if (gateResult.userAskedTangent || !gateResult.shouldScriptVoice) {
      if (gateResult.userAnsweredOpenField || gateResult.userAskedTangent) {
        try {
          Metrics.increment('opqrst.repeat_blocked', 1);
        } catch (_) {}
      }
      return reply;
    }
    if (gateResult.scriptedLine) return gateResult.scriptedLine;
    return reply;
  }

  if (!state.triageRow) return reply;
  const resolved = OpqrstFieldGate.resolve({
    triageRow: state.triageRow,
    userMessage: state.last_user_message || '',
    lastAssistantText: state.last_assistant_text || '',
    activeLane: state.active_lane,
    conversationMode: state.conversation_mode || state.flags?.conversation_mode,
    activeSubrail: state.active_subrail || state.flags?.active_subrail,
    opqrstFrozen: !!(state.flags?.opqrst_frozen),
    triagePolicy: state.triagePolicy || 'conditional',
    specialty: state.triageRow?.target_specialty,
    opqrstResumeField: state.flags?.opqrst_resume_field,
    locale
  });
  if (resolved.userAskedTangent || !resolved.shouldScriptVoice) {
    return reply;
  }
  if (resolved.scriptedLine) return resolved.scriptedLine;
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
  applyClinicalOpqrstVoiceLineLegacy,
  formatVoiceReply
};
