'use strict';

const { KELLY_LANE } = require('../state-schema');

async function runDeterministicSafety(state, ctx) {
  if (state.active_lane !== KELLY_LANE.SUPPORT || state.step !== 'handoff' || !state.flags.safety_blocked) {
    return null;
  }
  return {
    reply:
      'This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now. I cannot schedule visits or take payments during an emergency.',
    toolsUsed: [],
    endCall: true
  };
}

module.exports = { runDeterministicSafety };
