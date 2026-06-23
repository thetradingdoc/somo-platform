'use strict';

const Metrics = require('../shared/metrics');
const KellyToolExecutor = require('../kelly/kelly-tool-executor');

function tokenize(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  const sa = new Set(tokenize(a).map((w) => w.toLowerCase()));
  const sb = new Set(tokenize(b).map((w) => w.toLowerCase()));
  if (!sa.size && !sb.size) return 0;
  let inter = 0;
  for (const w of sa) {
    if (sb.has(w)) inter++;
  }
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

/**
 * Record conversational SLO counters for a voice assistant turn.
 */
function recordVoiceAssistantTurn(opts = {}) {
  const sessionId = String(opts.sessionId || '').trim();
  if (!sessionId) return;

  const replyText = String(opts.replyText || '');
  const conversationHistory = Array.isArray(opts.conversationHistory) ? opts.conversationHistory : [];
  const metricsSessionKey = `voice.metrics.session.${sessionId}.`;

  const questionCount = (replyText.match(/\?/g) || []).length;
  const assistantWords = tokenize(replyText).length;
  const prevAssistants = conversationHistory
    .filter((m) => m && m.role === 'assistant' && m.content)
    .slice(-2)
    .map((m) => String(m.content));
  const looksRephrase = prevAssistants.some((p) => jaccard(p, replyText) >= 0.72);

  Metrics.increment('voice.metrics.assistant_turns', 1);
  Metrics.increment(`${metricsSessionKey}assistant_turns`, 1);
  Metrics.increment('voice.metrics.assistant_words_total', assistantWords);
  Metrics.increment(`${metricsSessionKey}assistant_words_total`, assistantWords);

  if (questionCount > 1) {
    Metrics.increment('voice.metrics.multi_question_turns', 1);
    Metrics.increment(`${metricsSessionKey}multi_question_turns`, 1);
  }
  if (looksRephrase) {
    Metrics.increment('voice.metrics.rephrase_within_2_turns', 1);
    Metrics.increment(`${metricsSessionKey}rephrase_within_2_turns`, 1);
  }

  const firstUserAtRaw = KellyToolExecutor._getSessionMeta(sessionId, 'voice_first_user_turn_at_ms');
  if (!firstUserAtRaw) {
    KellyToolExecutor._setSessionMeta(sessionId, 'voice_first_user_turn_at_ms', String(Date.now()));
  }
  const firstHelpfulRaw = KellyToolExecutor._getSessionMeta(sessionId, 'voice_first_helpful_response_at_ms');
  const helpful = assistantWords >= 8 && !/\bi'?m here\b/i.test(replyText);
  if (!firstHelpfulRaw && helpful) {
    const nowMs = Date.now();
    KellyToolExecutor._setSessionMeta(sessionId, 'voice_first_helpful_response_at_ms', String(nowMs));
    const firstUserAt = Number(
      KellyToolExecutor._getSessionMeta(sessionId, 'voice_first_user_turn_at_ms') || nowMs
    );
    const delta = Math.max(0, nowMs - firstUserAt);
    Metrics.increment('voice.metrics.time_to_first_helpful_response_ms_total', delta);
    Metrics.increment('voice.metrics.time_to_first_helpful_response_ms_count', 1);
    Metrics.increment(`${metricsSessionKey}time_to_first_helpful_response_ms`, delta);
  }
}

module.exports = { recordVoiceAssistantTurn, tokenize, jaccard };
