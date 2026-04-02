const db = require('../database');

const CHECKOUT_STAGES = Object.freeze({
  COLLECTING_DETAILS: 'collecting_details',
  CODE_SENT: 'code_sent',
  CODE_VERIFIED: 'code_verified',
  CHECKOUT_PREPARED: 'checkout_prepared',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  FAILED: 'failed'
});

function ensureSessionMetaTable() {
  try {
    db.db.prepare(`
      CREATE TABLE IF NOT EXISTS kelly_session_meta_kv (
        session_id  TEXT NOT NULL,
        meta_key    TEXT NOT NULL,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, meta_key)
      )
    `).run();
  } catch (_) {}
}

function setSessionMeta(sessionId, key, value) {
  try {
    if (!sessionId || !key) return;
    ensureSessionMetaTable();
    db.db.prepare(`
      INSERT OR REPLACE INTO kelly_session_meta_kv (session_id, meta_key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(String(sessionId), String(key), String(value));
  } catch (_) {}
}

function getSessionMeta(sessionId, key) {
  try {
    if (!sessionId || !key) return null;
    ensureSessionMetaTable();
    const row = db.db.prepare(`
      SELECT value
      FROM kelly_session_meta_kv
      WHERE session_id = ? AND meta_key = ?
      LIMIT 1
    `).get(String(sessionId), String(key));
    return row?.value ?? null;
  } catch (_) {
    return null;
  }
}

function getCheckoutContextVersion(sessionId) {
  const raw = parseInt(String(getSessionMeta(sessionId, 'checkout_context_version') || '1'), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function getCheckoutStage(sessionId) {
  const raw = getSessionMeta(sessionId, 'checkout_stage');
  return String(raw || CHECKOUT_STAGES.COLLECTING_DETAILS);
}

function transitionStage(sessionId, stage, extra = null) {
  if (!sessionId || !stage) return false;
  const prevStage = getCheckoutStage(sessionId);
  const noRewindGuard = String(process.env.CHECKOUT_ALLOW_STAGE_REWIND || 'false').toLowerCase() === 'true';
  const protectedStages = new Set([
    CHECKOUT_STAGES.CHECKOUT_PREPARED,
    CHECKOUT_STAGES.PAYMENT_CONFIRMED,
    CHECKOUT_STAGES.FAILED
  ]);
  const rewindTargets = new Set([
    CHECKOUT_STAGES.COLLECTING_DETAILS,
    CHECKOUT_STAGES.CODE_SENT,
    CHECKOUT_STAGES.CODE_VERIFIED
  ]);
  if (!noRewindGuard && protectedStages.has(String(prevStage || '')) && rewindTargets.has(String(stage || ''))) {
    return false;
  }

  const guardsEnabled = String(process.env.CHECKOUT_RAIL_GUARDS_ENABLED || 'true').toLowerCase() !== 'false';
  if (guardsEnabled && String(stage) === CHECKOUT_STAGES.CHECKOUT_PREPARED) {
    const bypass = !!(extra && typeof extra === 'object' && extra.allow_skip_guard);
    if (!bypass) {
      const currentVersion = getCheckoutContextVersion(sessionId);
      const verifiedVersion = parseInt(String(getSessionMeta(sessionId, 'commerce_email_verified_context_version') || '0'), 10);
      const shippingVersion = parseInt(String(getSessionMeta(sessionId, 'commerce_shipping_context_version') || '0'), 10);
      const shippingComplete = String(getSessionMeta(sessionId, 'commerce_shipping_complete') || '') === '1';
      if (!shippingComplete || verifiedVersion !== currentVersion || shippingVersion !== currentVersion) {
        return false;
      }
    }
  }

  setSessionMeta(sessionId, 'checkout_stage', String(stage));
  setSessionMeta(sessionId, 'checkout_stage_updated_at_ms', String(Date.now()));
  const transitionMeta = extra && typeof extra === 'object' ? { ...extra } : {};
  if (!Object.prototype.hasOwnProperty.call(transitionMeta, 'source')) transitionMeta.source = 'checkout_workflow_service';
  if (!Object.prototype.hasOwnProperty.call(transitionMeta, 'timestamp_ms')) transitionMeta.timestamp_ms = Date.now();
  if (!Object.prototype.hasOwnProperty.call(transitionMeta, 'actor')) transitionMeta.actor = 'system';
  if (!Object.prototype.hasOwnProperty.call(transitionMeta, 'request_id')) transitionMeta.request_id = '';
  if (!Object.prototype.hasOwnProperty.call(transitionMeta, 'context_version')) {
    transitionMeta.context_version = getCheckoutContextVersion(sessionId);
  }
  for (const [k, v] of Object.entries(transitionMeta)) {
    setSessionMeta(sessionId, `checkout_stage_meta_${k}`, String(v));
  }
  return true;
}

function recoverStaleInFlightSessions({ ttlMs = 120000, limit = 200 } = {}) {
  ensureSessionMetaTable();
  const staleRows = db.db.prepare(`
    SELECT session_id, updated_at
    FROM kelly_session_meta_kv
    WHERE meta_key = 'verified_transition_inflight'
      AND value = '1'
      AND datetime(updated_at) <= datetime('now', '-' || ? || ' seconds')
    LIMIT ?
  `).all(String(Math.max(30, Math.floor(ttlMs / 1000))), Math.max(1, Number(limit) || 200));
  let recovered = 0;
  for (const row of staleRows) {
    const sid = String(row?.session_id || '').trim();
    if (!sid) continue;
    const checkoutId = String(getSessionMeta(sid, 'checkout_stage_meta_checkout_id') || '').trim();
    if (checkoutId) continue;
    setSessionMeta(sid, 'verified_transition_inflight', '0');
    setSessionMeta(sid, 'payment_status_source', 'stale_inflight_reaper');
    setSessionMeta(sid, 'payment_status_last_checked_at', String(Date.now()));
    recovered += 1;
  }
  return { scanned: staleRows.length, recovered };
}

function validateCheckoutInvariants(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { session_id: sid, valid: false, violations: ['session_id_required'] };
  const stage = getCheckoutStage(sid);
  const violations = [];
  const pi = String(getSessionMeta(sid, 'checkout_stage_meta_payment_intent_id') || '').trim();
  const shippingComplete = String(getSessionMeta(sid, 'commerce_shipping_complete') || '') === '1';
  const shippingRaw = String(getSessionMeta(sid, 'commerce_shipping_address') || '').trim();
  const inflight = String(getSessionMeta(sid, 'verified_transition_inflight') || '0') === '1';
  const checkoutId = String(getSessionMeta(sid, 'checkout_stage_meta_checkout_id') || '').trim();

  if (stage === CHECKOUT_STAGES.CHECKOUT_PREPARED && !pi) violations.push('prepared_missing_payment_intent');
  if (stage === CHECKOUT_STAGES.CODE_VERIFIED && !shippingComplete) violations.push('verified_missing_shipping_complete');
  if (shippingComplete && !shippingRaw) violations.push('shipping_complete_without_address');
  if (inflight && checkoutId) violations.push('inflight_with_checkout_id');
  if (stage === CHECKOUT_STAGES.PAYMENT_CONFIRMED && !pi) violations.push('confirmed_missing_payment_intent');

  return {
    session_id: sid,
    stage,
    valid: violations.length === 0,
    violations
  };
}

module.exports = {
  CHECKOUT_STAGES,
  setSessionMeta,
  getSessionMeta,
  getCheckoutStage,
  transitionStage,
  recoverStaleInFlightSessions,
  validateCheckoutInvariants
};
