'use strict';

const crypto = require('crypto');
const db = require('../../database');

let ensured = false;
function ensureTable() {
  if (ensured) return;
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS anti_sybil_events (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        identity_hash TEXT,
        ip_hash TEXT,
        user_agent_hash TEXT,
        amount_cents INTEGER,
        risk_score INTEGER DEFAULT 0,
        decision TEXT DEFAULT 'allow',
        reasons_json TEXT,
        created_at DATETIME DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_anti_sybil_scope_created_at ON anti_sybil_events(scope, created_at);
      CREATE INDEX IF NOT EXISTS idx_anti_sybil_identity_created_at ON anti_sybil_events(identity_hash, created_at);
      CREATE INDEX IF NOT EXISTS idx_anti_sybil_ip_created_at ON anti_sybil_events(ip_hash, created_at);

      CREATE TABLE IF NOT EXISTS anti_sybil_appeals (
        id TEXT PRIMARY KEY,
        anti_sybil_event_id TEXT,
        contact_email TEXT,
        scope TEXT,
        reason TEXT,
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT (datetime('now')),
        reviewed_at DATETIME,
        reviewer TEXT,
        decision_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_anti_sybil_appeals_status_created_at ON anti_sybil_appeals(status, created_at);

      CREATE TABLE IF NOT EXISTS fraud_review_queue (
        id TEXT PRIMARY KEY,
        anti_sybil_event_id TEXT,
        scope TEXT,
        status TEXT DEFAULT 'open', -- open | in_review | resolved | dismissed
        priority TEXT DEFAULT 'normal', -- low | normal | high | critical
        assigned_to TEXT,
        sla_due_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now')),
        updated_at DATETIME DEFAULT (datetime('now')),
        breach_alerted_at DATETIME,
        resolution_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fraud_review_queue_status_sla ON fraud_review_queue(status, sla_due_at);
      CREATE INDEX IF NOT EXISTS idx_fraud_review_queue_assigned ON fraud_review_queue(assigned_to, status);
    `);
    try {
      const cols = db.db.prepare(`PRAGMA table_info(fraud_review_queue)`).all();
      const hasBreachAlertedAt = Array.isArray(cols) && cols.some((c) => String(c?.name || '') === 'breach_alerted_at');
      if (!hasBreachAlertedAt) {
        db.db.exec(`ALTER TABLE fraud_review_queue ADD COLUMN breach_alerted_at DATETIME`);
      }
    } catch (_) {}
    ensured = true;
  } catch (e) {
    console.warn('[AntiSybil] ensureTable failed:', e.message);
  }
}

function h(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  return crypto.createHash('sha256').update(s).digest('hex');
}

function getCount(sql, ...args) {
  try {
    const row = db.db.prepare(sql).get(...args);
    return Number(row?.c || 0);
  } catch (_) {
    return 0;
  }
}

function evaluateAndRecord({ scope, identityKey, ip, userAgent, amountCents = 0 }) {
  ensureTable();
  const identityHash = h(identityKey);
  const ipHash = h(ip);
  const uaHash = h(userAgent);
  const safeScope = String(scope || 'unknown').trim() || 'unknown';

  let score = 0;
  const reasons = [];

  const identityBurst15 = identityHash
    ? getCount(
      `SELECT COUNT(*) AS c FROM anti_sybil_events
       WHERE scope = ? AND identity_hash = ? AND datetime(created_at) > datetime('now', '-15 minutes')`,
      safeScope,
      identityHash
    )
    : 0;
  if (identityBurst15 >= 8) {
    score += 45;
    reasons.push('identity_burst_15m');
  } else if (identityBurst15 >= 4) {
    score += 20;
    reasons.push('identity_elevated_15m');
  }

  const ipBurst10 = ipHash
    ? getCount(
      `SELECT COUNT(*) AS c FROM anti_sybil_events
       WHERE scope = ? AND ip_hash = ? AND datetime(created_at) > datetime('now', '-10 minutes')`,
      safeScope,
      ipHash
    )
    : 0;
  if (ipBurst10 >= 20) {
    score += 35;
    reasons.push('ip_burst_10m');
  } else if (ipBurst10 >= 10) {
    score += 15;
    reasons.push('ip_elevated_10m');
  }

  const distinctIdentitiesPerIp1h = ipHash
    ? getCount(
      `SELECT COUNT(DISTINCT identity_hash) AS c FROM anti_sybil_events
       WHERE scope = ? AND ip_hash = ? AND datetime(created_at) > datetime('now', '-1 hour')`,
      safeScope,
      ipHash
    )
    : 0;
  if (distinctIdentitiesPerIp1h >= 12) {
    score += 30;
    reasons.push('high_identity_fanout_ip');
  }

  if (Number(amountCents || 0) >= 50000) {
    score += 10;
    reasons.push('high_value_attempt');
  }

  const decision = score >= 70 ? 'block' : score >= 35 ? 'challenge' : 'allow';
  const id = `as_${crypto.randomBytes(12).toString('hex')}`;
  try {
    db.db.prepare(`
      INSERT INTO anti_sybil_events
      (id, scope, identity_hash, ip_hash, user_agent_hash, amount_cents, risk_score, decision, reasons_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      safeScope,
      identityHash,
      ipHash,
      uaHash,
      Number(amountCents || 0),
      score,
      decision,
      JSON.stringify(reasons)
    );
  } catch (_) {}

  return { score, decision, reasons, eventId: id };
}

function enqueueFraudReview({ antiSybilEventId, scope, priority = 'normal', slaMinutes = 120 }) {
  ensureTable();
  const id = `frq_${crypto.randomBytes(12).toString('hex')}`;
  const p = ['low', 'normal', 'high', 'critical'].includes(String(priority || '').toLowerCase())
    ? String(priority).toLowerCase()
    : 'normal';
  const mins = Math.max(5, parseInt(String(slaMinutes || 120), 10) || 120);
  db.db.prepare(`
    INSERT INTO fraud_review_queue
    (id, anti_sybil_event_id, scope, status, priority, sla_due_at, updated_at)
    VALUES (?, ?, ?, 'open', ?, datetime('now', ?), datetime('now'))
  `).run(
    id,
    antiSybilEventId ? String(antiSybilEventId).trim() : null,
    String(scope || '').trim() || null,
    p,
    `+${mins} minutes`
  );
  return { id, status: 'open', priority: p };
}

function listFraudReviews({ status = null, limit = 100 } = {}) {
  ensureTable();
  const lim = Math.max(1, Math.min(500, parseInt(String(limit || 100), 10) || 100));
  if (status) {
    return db.db.prepare(`
      SELECT * FROM fraud_review_queue
      WHERE status = ?
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(status, lim);
  }
  return db.db.prepare(`
    SELECT * FROM fraud_review_queue
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(lim);
}

function assignFraudReview({ reviewId, reviewer, slaMinutes = null }) {
  ensureTable();
  const r = db.db.prepare(`SELECT * FROM fraud_review_queue WHERE id = ? LIMIT 1`).get(reviewId);
  if (!r) return { success: false, error: 'not_found' };
  if (slaMinutes && Number.isFinite(Number(slaMinutes))) {
    db.db.prepare(`
      UPDATE fraud_review_queue
      SET assigned_to = ?, status = 'in_review',
          sla_due_at = datetime('now', ?), updated_at = datetime('now')
      WHERE id = ?
    `).run(String(reviewer || '').trim() || null, `+${Math.max(5, Number(slaMinutes))} minutes`, reviewId);
  } else {
    db.db.prepare(`
      UPDATE fraud_review_queue
      SET assigned_to = ?, status = 'in_review', updated_at = datetime('now')
      WHERE id = ?
    `).run(String(reviewer || '').trim() || null, reviewId);
  }
  return { success: true };
}

function resolveFraudReview({ reviewId, outcome, note = '' }) {
  ensureTable();
  const allowed = ['resolved', 'dismissed'];
  const status = allowed.includes(String(outcome || '').toLowerCase()) ? String(outcome).toLowerCase() : null;
  if (!status) return { success: false, error: 'invalid_outcome' };
  const r = db.db.prepare(`UPDATE fraud_review_queue SET status = ?, resolution_note = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    String(note || '').trim().slice(0, 2000) || null,
    reviewId
  );
  return { success: r.changes > 0 };
}

function listOverdueFraudReviews({ limit = 50 } = {}) {
  ensureTable();
  const lim = Math.max(1, Math.min(500, parseInt(String(limit || 50), 10) || 50));
  return db.db.prepare(`
    SELECT *
    FROM fraud_review_queue
    WHERE status IN ('open', 'in_review')
      AND sla_due_at IS NOT NULL
      AND datetime(sla_due_at) <= datetime('now')
      AND breach_alerted_at IS NULL
    ORDER BY datetime(sla_due_at) ASC
    LIMIT ?
  `).all(lim);
}

function markFraudReviewAlerted(reviewId) {
  ensureTable();
  const r = db.db.prepare(`
    UPDATE fraud_review_queue
    SET breach_alerted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND breach_alerted_at IS NULL
  `).run(reviewId);
  return r.changes > 0;
}

function submitAppeal({ antiSybilEventId = null, contactEmail = null, scope = null, reason = '' }) {
  ensureTable();
  const id = `asa_${crypto.randomBytes(12).toString('hex')}`;
  const safeReason = String(reason || '').trim().slice(0, 2000);
  const safeEmail = String(contactEmail || '').trim().toLowerCase().slice(0, 254) || null;
  const safeScope = String(scope || '').trim().slice(0, 80) || null;
  db.db.prepare(`
    INSERT INTO anti_sybil_appeals
    (id, anti_sybil_event_id, contact_email, scope, reason, status)
    VALUES (?, ?, ?, ?, ?, 'open')
  `).run(
    id,
    antiSybilEventId ? String(antiSybilEventId).trim() : null,
    safeEmail,
    safeScope,
    safeReason
  );
  return { id, status: 'open' };
}

module.exports = {
  evaluateAndRecord,
  submitAppeal,
  enqueueFraudReview,
  listFraudReviews,
  assignFraudReview,
  resolveFraudReview,
  listOverdueFraudReviews,
  markFraudReviewAlerted
};

