'use strict';

const healthTurnService = require('./health-turn-service');
const healthSessionService = require('./health-session-service');

/**
 * Kelly PA reply for consumer health-* video rooms (patient speech only, is_final).
 */
async function maybeReplyToPatientTranscript(roomId, text, options = {}) {
  if (!healthSessionService.isHealthRoom(roomId)) return null;
  return healthTurnService.processPatientTurn(roomId, text, options);
}

module.exports = {
  maybeReplyToPatientTranscript
};
