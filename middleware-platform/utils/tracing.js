/**
 * Tracing utilities for correlating calls across websocket, brain, and tools.
 */

const crypto = require('crypto');

function createTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  createTraceId
};

