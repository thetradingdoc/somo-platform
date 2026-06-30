'use strict';

/**
 * Single turn ingress contract for consumer health sessions.
 * - ui_turn: POST /api/health-session/:id/turn (browser typed text / browser STT)
 * - stt: agent-events transcript when HEALTH_SERVER_STT_ENABLED and not HEALTH_BROWSER_STT_ONLY
 */
const featureFlags = require('./feature-flags');

const MODES = {
  UI_TURN: 'ui_turn',
  STT: 'stt'
};

function activeIngressModes() {
  const modes = [MODES.UI_TURN];
  if (featureFlags.serverSttEnabled() && !featureFlags.browserSttOnly()) {
    modes.push(MODES.STT);
  }
  return modes;
}

function isIngressAllowed(source) {
  const s = source || MODES.UI_TURN;
  return activeIngressModes().includes(s === 'browser_stt' ? MODES.STT : s);
}

module.exports = {
  MODES,
  activeIngressModes,
  isIngressAllowed
};
