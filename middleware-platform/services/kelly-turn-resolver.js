'use strict';

const KellyAgentService = require('./kelly-agent-service');
const KellyConversationGraph = require('./kelly-conversation-graph');
const { runKellyConversationTurn } = require('./kelly-conversation-bridge');
const { handleTurn, shouldUseKellyRailsV2 } = require('./kelly-rails/orchestrator');
const db = require('../database');
const { detectLanguage, minLanguageConfidence } = require('./kelly-rails/language');

function allowHybridGraphFallback() {
  const v = String(process.env.KELLY_ALLOW_HYBRID_GRAPH || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Single Kelly conversation turn — priority: KELLY_RAILS_V2 → hybrid graph+processTurn → legacy.
 */
async function runKellyTurn(opts = {}) {
  const sessionId = String(opts.sessionId || '').trim();
  const clinicId = opts.clinicId || null;
  const message = String(opts.message || opts.userMessage || '').trim();
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionId || null,
      event_type: 'turn_received',
      payload_json: { clinic_id: clinicId || null, channel: opts.channel || null }
    });
  } catch (_) {}

  if (sessionId && message && db.getKellySessionLanguage && db.upsertKellySessionLanguage) {
    const existing = db.getKellySessionLanguage(sessionId);
    if (!existing) {
      const detected = detectLanguage(message);
      db.upsertKellySessionLanguage(sessionId, detected.language);
      opts.preferredLanguage = detected.language;
      opts.languageConfidence = detected.confidence;
      if (detected.confidence < minLanguageConfidence() && detected.language !== 'en') {
        opts.forceLanguageHandoff = true;
      }
    }
  }

  if (sessionId && shouldUseKellyRailsV2(sessionId, clinicId)) {
    const out = await handleTurn(opts);
    try {
      db.insertKellyCallEvent?.({
        session_id: sessionId || null,
        event_type: 'turn_resolved',
        payload_json: {
          runtime: 'kelly_rails_v2',
          lane: out?.kelly_rails?.active_lane || null,
          step: out?.kelly_rails?.step || null,
          tools_used: out?.toolsUsed || []
        }
      });
    } catch (_) {}
    return out;
  }
  if (
    allowHybridGraphFallback() &&
    sessionId &&
    KellyConversationGraph.shouldUseKellyGraph(sessionId, clinicId)
  ) {
    const out = await runKellyConversationTurn(opts);
    try {
      db.insertKellyCallEvent?.({
        session_id: sessionId || null,
        event_type: 'turn_resolved',
        payload_json: { runtime: 'hybrid_graph', tools_used: out?.toolsUsed || [] }
      });
    } catch (_) {}
    return out;
  }
  const out = await KellyAgentService.processTurn(opts);
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionId || null,
      event_type: 'turn_resolved',
      payload_json: { runtime: 'legacy_process_turn', tools_used: out?.toolsUsed || [] }
    });
  } catch (_) {}
  return out;
}

module.exports = { runKellyTurn, shouldUseKellyRailsV2 };
