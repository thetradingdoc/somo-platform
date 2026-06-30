#!/usr/bin/env node
'use strict';

/**
 * Fake Retell WebSocket sessions — distinct callId, no cross-talk.
 */
process.chdir(require('path').join(__dirname, '..'));
process.env.VOICE_RATE_LIMIT_BACKEND = process.env.VOICE_RATE_LIMIT_BACKEND || 'memory';

const CallSessionService = require('../services/call-session-service');

async function main() {
  CallSessionService.sessions.clear();
  const activeConnections = new Map();
  const sessions = 10;
  const callIds = [];

  for (let i = 0; i < sessions; i += 1) {
    const callId = `ws_smoke_${i}_${Date.now()}`;
    callIds.push(callId);
    CallSessionService.startSession({ callId, clinicId: 'clinic-smoke' });
    activeConnections.set(callId, { callId, ws: { readyState: 1 } });
  }

  if (activeConnections.size !== sessions || CallSessionService.sessions.size !== sessions) {
    console.error('FAIL: session count mismatch');
    process.exit(1);
  }

  CallSessionService.updateSession(callIds[0], { smoke: true });
  if (CallSessionService.getSession(callIds[1]).smoke) {
    console.error('FAIL: cross-talk — smoke flag leaked to second session');
    process.exit(1);
  }

  for (const callId of callIds) {
    const conn = activeConnections.get(callId);
    if (!conn || conn.callId !== callId) {
      console.error(`FAIL: cross-talk for ${callId}`);
      process.exit(1);
    }
  }

  console.log(`OK voice-ws-smoke sessions=${sessions} distinct callIds verified`);
}

main().catch((err) => {
  console.error('FAIL voice-ws-smoke:', err.message);
  process.exit(1);
});
