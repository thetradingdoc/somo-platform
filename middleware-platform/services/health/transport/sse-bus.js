'use strict';

/**
 * Pluggable SSE bus — in-memory default; swap for Redis in multi-replica deploys.
 */
const memoryAdapter = require('../../video-consult-sse');

function getAdapter() {
  const backend = String(process.env.HEALTH_SSE_BUS || 'memory').toLowerCase();
  if (backend === 'redis') {
    try {
      return require('./sse-redis-adapter');
    } catch (_) {
      console.warn('[health-sse-bus] Redis adapter not available — falling back to memory');
    }
  }
  return memoryAdapter;
}

module.exports = {
  register: (...args) => getAdapter().register(...args),
  broadcastTranscriptDelta: (...args) => getAdapter().broadcastTranscriptDelta(...args),
  broadcastAssistantMessage: (...args) => getAdapter().broadcastAssistantMessage(...args),
  broadcastAssistantUpdate: (...args) => getAdapter().broadcastAssistantUpdate(...args),
  broadcastToolEvent: (...args) => getAdapter().broadcastToolEvent(...args),
  broadcastRiskAlert: (...args) => getAdapter().broadcastRiskAlert(...args),
  broadcastSessionEnded: (...args) => getAdapter().broadcastSessionEnded(...args)
};
