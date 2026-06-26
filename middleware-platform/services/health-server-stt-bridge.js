'use strict';

/**
 * Post-MVP F-1: Deepgram server STT via LiveKit transcription agent.
 * When HEALTH_SERVER_STT_ENABLED=true, run livekit-agents/transcription_agent.py
 * and disable browser STT in the UI (VITE_HEALTH_SERVER_STT_ENABLED=true).
 */
const featureFlags = require('./health-video-feature-flags');

function isServerSttPreferred() {
  return featureFlags.serverSttEnabled();
}

function serverSttInstructions() {
  return {
    enabled: isServerSttPreferred(),
    agent: 'livekit-agents/transcription_agent.py',
    endpoint: '/api/video-consult/agent-events',
    note: 'Requires DEEPGRAM_API_KEY and MIDDLEWARE_URL; disable HEALTH_BROWSER_STT_ONLY when active'
  };
}

module.exports = {
  isServerSttPreferred,
  serverSttInstructions
};
