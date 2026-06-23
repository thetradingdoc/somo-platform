'use strict';

/**
 * Kelly turn dispatch bridge for Retell WS (Phase 4 — extract incrementally from retell-websocket.js).
 */
const { runKellyTurn } = require('../../services/kelly/kelly-turn-resolver');

async function dispatchKellyTurn(params) {
  return runKellyTurn(params);
}

module.exports = { dispatchKellyTurn };
