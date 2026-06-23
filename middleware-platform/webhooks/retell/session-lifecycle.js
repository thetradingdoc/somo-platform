'use strict';

const CallSessionService = require('../../services/voice/call-session-service');

function extractCallId(req) {
  return (
    req.headers['x-retell-call-id'] ||
    req.url.split('/').pop() ||
    `call_${Date.now()}`
  );
}

function loadExistingCallState(db, callId) {
  if (typeof db.getCallState !== 'function') return null;
  try {
    return db.getCallState(callId) || null;
  } catch (e) {
    console.warn('⚠️  Failed to load call state for resumption:', e.message);
    return null;
  }
}

function startRetellCallSession(callId, existingState) {
  return CallSessionService.startSession({
    callId,
    clinicId: existingState?.clinic_id || null,
    metadata: {
      channel: 'voice',
      transport: 'retell'
    }
  });
}

module.exports = {
  extractCallId,
  loadExistingCallState,
  startRetellCallSession
};
