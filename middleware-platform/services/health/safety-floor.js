'use strict';

const SafetyPreScreen = require('../safety-prescreen');
const { emergencyReply } = require('./agent/prompt');
const { sanitizeDiagnosisLanguage } = require('./diagnosis-guard');

function evaluateHealthTurnSafety({ text, roomId, options = {} }) {
  const safety = SafetyPreScreen.evaluateSafety({
    text,
    eventType: 'transcript',
    payload: options,
    roomId
  });
  if (safety.emergency || safety.status === 'red') {
    return {
      shortCircuit: true,
      reply: emergencyReply(options.reply_language || 'en'),
      safety
    };
  }
  return { shortCircuit: false, safety };
}

function sanitizeAssistantReply(text) {
  return sanitizeDiagnosisLanguage(text);
}

module.exports = {
  evaluateHealthTurnSafety,
  sanitizeAssistantReply
};
