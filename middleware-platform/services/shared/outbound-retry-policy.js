'use strict';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_INTERVAL_MS = 15 * 60 * 1000;

function getOutboundAttemptKey({ phone_number, customer_id, lead_id } = {}) {
  const phone = String(phone_number || '').replace(/\D/g, '').slice(-10);
  return `${customer_id || 'na'}:${lead_id || 'na'}:${phone}`;
}

function checkOutboundRetryAllowed(db, params = {}) {
  const maxAttempts = Number(process.env.OUTBOUND_MAX_RETRY_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
  const minIntervalMs = Number(process.env.OUTBOUND_MIN_RETRY_INTERVAL_MS || DEFAULT_MIN_INTERVAL_MS);
  const key = getOutboundAttemptKey(params);
  if (!db?.db) return { allowed: true, attempt: 1 };

  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS outbound_call_attempts (
        attempt_key TEXT PRIMARY KEY,
        attempt_count INTEGER DEFAULT 0,
        last_attempt_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const row = db.db.prepare('SELECT * FROM outbound_call_attempts WHERE attempt_key = ?').get(key);
    const count = row?.attempt_count || 0;
    if (count >= maxAttempts) {
      const err = new Error(`Outbound retry cap reached (${maxAttempts})`);
      err.code = 'outbound_retry_cap';
      throw err;
    }
    if (minIntervalMs > 0 && row?.last_attempt_at) {
      const last = new Date(row.last_attempt_at).getTime();
      if (Date.now() - last < minIntervalMs) {
        const err = new Error('Outbound retry interval not elapsed');
        err.code = 'outbound_retry_interval';
        throw err;
      }
    }
    const next = count + 1;
    db.db
      .prepare(
        `INSERT INTO outbound_call_attempts (attempt_key, attempt_count, last_attempt_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(attempt_key) DO UPDATE SET
           attempt_count = excluded.attempt_count,
           last_attempt_at = excluded.last_attempt_at,
           updated_at = datetime('now')`
      )
      .run(key, next);
    return { allowed: true, attempt: next, attempt_key: key };
  } catch (e) {
    if (e.code === 'outbound_retry_cap' || e.code === 'outbound_retry_interval') throw e;
    return { allowed: true, attempt: 1 };
  }
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MIN_INTERVAL_MS,
  getOutboundAttemptKey,
  checkOutboundRetryAllowed
};
