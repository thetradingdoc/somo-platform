'use strict';

const KellyAgentService = require('./kelly-agent-service');
const KellyConversationGraph = require('./kelly-conversation-graph');
const { runKellyConversationTurn } = require('./kelly-conversation-bridge');
const { handleTurn, shouldUseKellyRailsV2 } = require('./kelly-rails/orchestrator');

/**
 * Single Kelly conversation turn — priority: KELLY_RAILS_V2 → hybrid graph+processTurn → legacy.
 */
async function runKellyTurn(opts = {}) {
  const sessionId = String(opts.sessionId || '').trim();
  const clinicId = opts.clinicId || null;

  if (sessionId && shouldUseKellyRailsV2(sessionId, clinicId)) {
    return handleTurn(opts);
  }
  if (sessionId && KellyConversationGraph.shouldUseKellyGraph(sessionId, clinicId)) {
    return runKellyConversationTurn(opts);
  }
  return KellyAgentService.processTurn(opts);
}

module.exports = { runKellyTurn, shouldUseKellyRailsV2 };
