'use strict';

/** Voice domain barrel — modules migrate here incrementally (Phase 4). */
module.exports = {
  incomingHandler: require('../voice-incoming-handler'),
  agentRuntime: require('../voice-agent-runtime'),
  retellService: require('../retell-service')
};
