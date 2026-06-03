'use strict';

const { isKellyRailsV2Enabled, shouldUseKellyRailsV2 } = require('./config');

function isProductionKellyEnforced() {
  if (String(process.env.KELLY_RUNTIME_PROFILE || '').trim().toLowerCase() === 'production') {
    return true;
  }
  return process.env.NODE_ENV === 'production';
}

function isHybridGraphAllowed() {
  if (isProductionKellyEnforced()) return false;
  const v = String(process.env.KELLY_ALLOW_HYBRID_GRAPH || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

function isLegacyProcessTurnAllowed() {
  if (isProductionKellyEnforced()) return false;
  const v = String(process.env.KELLY_ALLOW_LEGACY_PROCESS_TURN || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** In production, always route eligible sessions to V2 when env flag is on. */
function shouldUseKellyRailsV2Production(sessionId, clinicId) {
  if (!isKellyRailsV2Enabled()) return false;
  if (isProductionKellyEnforced()) return true;
  return shouldUseKellyRailsV2(sessionId, clinicId);
}

function logBlockedRuntime(db, sessionId, attemptedRuntime, reason) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: sessionId || null,
      event_type: 'runtime_blocked',
      payload_json: { attempted_runtime: attemptedRuntime, reason }
    });
  } catch (_) {}
}

module.exports = {
  isProductionKellyEnforced,
  isHybridGraphAllowed,
  isLegacyProcessTurnAllowed,
  shouldUseKellyRailsV2Production,
  logBlockedRuntime
};
