'use strict';

const { shouldUseKellyRailsV2, isKellyRailsV2Enabled } = require('./config');
const { invokeMainGraph } = require('./main-graph');
const { routeOrchestratorLane } = require('./state-schema');

/**
 * Kelly Conversation Orchestrator — V2 entry (no KellyAgentService.processTurn).
 */
async function handleTurn(opts = {}) {
  const db = require('../../database');
  if (opts.forceLanguageHandoff) {
    const language = opts.preferredLanguage || 'en';
    const reply =
      language === 'es'
        ? 'Quiero conectarte con un especialista para asegurar una comunicacion clinica segura en tu idioma. Un momento por favor.'
        : language === 'pt'
          ? 'Vou conectar voce com um especialista para garantir comunicacao clinica segura no seu idioma. Um momento, por favor.'
          : language === 'zh'
            ? '为了确保你使用的语言得到安全的临床沟通，我将为你转接人工支持，请稍候。'
            : 'I am connecting you with a specialist to ensure safe clinical communication in your language. One moment please.';
    try {
      db.insertKellyCallEvent?.({
        session_id: opts.sessionId || null,
        event_type: 'language_confidence_handoff',
        payload_json: { preferred_language: language, confidence: opts.languageConfidence || 0 }
      });
      const { emitLanguageMismatch } = require('../kelly-language-telemetry');
      emitLanguageMismatch(db, {
        session_id: opts.sessionId,
        detected_language: language,
        session_language: language,
        mismatch_type: 'language_confidence_handoff',
        action_taken: 'handoff',
        channel: opts.channel || 'chat',
        runtime: 'kelly_rails_v2'
      });
    } catch (_) {}
    return {
      reply,
      endCall: false,
      toolsUsed: [],
      language,
      kelly_rails: { active_lane: 'support', step: 'handoff', flags: { language_handoff: true } }
    };
  }

  const out = await invokeMainGraph(opts);
  const language =
    (require('../../database').getKellySessionLanguage &&
      require('../../database').getKellySessionLanguage(opts.sessionId)) ||
    opts.preferredLanguage ||
    'en';

  return {
    reply: out.reply || '',
    endCall: !!out.endCall,
    toolsUsed: out.toolsUsed || [],
    language,
    kelly_rails: {
      active_lane: out.state?.active_lane,
      step: out.state?.step,
      flags: out.state?.flags
    }
  };
}

module.exports = {
  handleTurn,
  shouldUseKellyRailsV2,
  isKellyRailsV2Enabled,
  routeOrchestratorLane
};
