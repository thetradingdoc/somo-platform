'use strict';

const fs = require('fs');
const path = require('path');

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

function envTruthy(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

function isKellyRailsEsEnabled(tenantLanguages = null) {
  if (tenantLanguages && Array.isArray(tenantLanguages) && tenantLanguages.length > 0) {
    return tenantLanguages.includes('es');
  }
  return envTruthy('KELLY_RAILS_ES_ENABLED');
}

function hasOpqrstEsSignoffFile() {
  const clinicalDir = path.join(__dirname, '..', '..', '..', 'docs', 'clinical');
  try {
    const files = fs.readdirSync(clinicalDir);
    return files.some((f) => /^OPQRST_ES_SIGNOFF_\d{4}-\d{2}-\d{2}\.md$/i.test(f));
  } catch (_) {
    return false;
  }
}

function isOpqrstEsPackActive() {
  const pack = String(process.env.KELLY_OPQRST_ES_PACK || '').trim();
  if (pack !== 'v1') return false;
  return hasOpqrstEsSignoffFile();
}

/** OPQRST Field Gate — default on (fixes provocation loop); set OPQRST_FIELD_GATE_ENABLED=0 for legacy rollback. */
function isOpqrstFieldGateEnabled() {
  const v = String(process.env.OPQRST_FIELD_GATE_ENABLED ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false';
}

module.exports = {
  isKellyRailsV2Enabled,
  shouldUseKellyRailsV2,
  getRolloutPct,
  isKellyRailsEsEnabled,
  isOpqrstEsPackActive,
  hasOpqrstEsSignoffFile,
  isOpqrstFieldGateEnabled,
  envTruthy
};
