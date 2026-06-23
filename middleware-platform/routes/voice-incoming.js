'use strict';

const { createVoiceIncomingHandler } = require('../services/voice/voice-incoming-handler');

/**
 * Register POST /voice/incoming (Twilio webhook).
 */
function registerVoiceIncomingRoute(app, deps) {
  const {
    express,
    voiceLimiter,
    twilioSignatureRequired,
    replayGuard,
    db,
    normalizePhoneNumber,
    clinicRateLimitCheck
  } = deps;

  const handler = createVoiceIncomingHandler({
    db,
    normalizePhoneNumber,
    clinicRateLimitCheck
  });

  app.post(
    '/voice/incoming',
    voiceLimiter,
    express.urlencoded({ extended: true }),
    twilioSignatureRequired,
    replayGuard({
      source: 'twilio_voice_incoming',
      ttlMinutes: 30,
      keyBuilder: (req) =>
        `${req.body?.CallSid || ''}:${req.body?.From || ''}:${req.body?.To || ''}`
    }),
    handler
  );
}

module.exports = { registerVoiceIncomingRoute };
