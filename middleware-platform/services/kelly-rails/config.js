'use strict';

/**
 * Kelly Rails V2 rollout — parallel to legacy processTurn when KELLY_RAILS_V2=0.
 */

function isKellyRailsV2Enabled() {
  return String(process.env.KELLY_RAILS_V2 || '').trim() === '1';
}

function getRolloutPct() {
  const raw = process.env.KELLY_RAILS_ROLLOUT_PCT;
  if (raw === undefined || raw === '') return 1;
  const pct = parseFloat(raw);
  return Number.isFinite(pct) ? pct : 0;
}

function hashSessionId(id) {
  let h = 0;
  for (let i = 0; i < (id || '').length; i++) {
    h = (h << 5) - h + id.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function shouldUseKellyRailsV2(sessionId, _clinicId = null) {
  if (!isKellyRailsV2Enabled()) return false;
  const pct = getRolloutPct();
  if (pct >= 1) return true;
  if (pct <= 0) return false;
  const useV2 = hashSessionId(sessionId) % 100 < pct * 100;
  return useV2;
}

module.exports = {
  isKellyRailsV2Enabled,
  shouldUseKellyRailsV2,
  getRolloutPct
};
