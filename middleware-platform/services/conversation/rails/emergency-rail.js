'use strict';

async function handleEmergencyTurn(ctx = {}) {
  return {
    reply:
      'This sounds like it could be an emergency. If you are in immediate danger, please hang up and call 911 now. I am connecting you with our care team right away.',
    endCall: false,
    toolsUsed: [],
    conversation_mode: 'emergency_safety',
    active_subrail: 'handoff',
    disposition: 'emergency_redirect',
    flags: { safety_blocked: true, pending_human_handoff: true }
  };
}

module.exports = { handleEmergencyTurn };
