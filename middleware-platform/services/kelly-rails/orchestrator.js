'use strict';

const { shouldUseKellyRailsV2, isKellyRailsV2Enabled } = require('./config');
const { invokeMainGraph } = require('./main-graph');
const { routeOrchestratorLane } = require('./state-schema');

/**
 * Kelly Conversation Orchestrator — V2 entry (no KellyAgentService.processTurn).
 */
async function handleTurn(opts = {}) {
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
