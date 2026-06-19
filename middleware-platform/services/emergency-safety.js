'use strict';

const { isEmergencyUtterance } = require('./kelly-rails/state-schema');

function emergencyReply(locale) {
  const language = String(locale || 'en').slice(0, 2);
  if (language === 'es') {
    return (
      'Si esto es una emergencia médica, cuelga y llama al 911 o ve a urgencias de inmediato. ' +
      'No puedo ayudar con emergencias en esta llamada.'
    );
  }
  return (
    'If this is a medical emergency, please hang up and call 911 or go to urgent care right away. ' +
    'I cannot help with emergencies on this call.'
  );
}

/**
 * Shared emergency scan for demo + tenant unidentified Kelly-block paths.
 * @returns {{ reply: string, endCall: boolean, outcome: string } | null}
 */
function getEmergencyResponseIfNeeded(userSaid, locale) {
  if (!userSaid || !isEmergencyUtterance(userSaid)) return null;
  return {
    reply: emergencyReply(locale),
    endCall: true,
    outcome: 'emergency_redirect'
  };
}

module.exports = {
  emergencyReply,
  getEmergencyResponseIfNeeded,
  isEmergencyUtterance
};
