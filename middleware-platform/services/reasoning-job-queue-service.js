'use strict';

const crypto = require('crypto');
const dbModule = require('../database');
const Metrics = require('./metrics');

const db = dbModule.db;
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Number(process.env.REASONING_JOB_MAX_ATTEMPTS || 3));
const DEFAULT_RETRY_BASE_MS = Math.max(100, Number(process.env.REASONING_JOB_RETRY_BASE_MS || 400));

function nowIso() {
  return new Date().toISOString();
}

function buildJobKey({ sessionId, snapshotVersion, contextHash }) {
  return `${String(sessionId || '').trim()}::${Number(snapshotVersion || 0)}::${String(contextHash || '').trim()}`;
}

function enqueueReasoningJob({
  sessionId,
  snapshotId,
  snapshotVersion = 0,
  contextHash = '',
  inputHash = '',
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  payload = {}
}) {
  const sid = String(sessionId || '').trim();
  const snapId = String(snapshotId || '').trim();
  const version = Number(snapshotVersion || 0);
  const ctxHash = String(contextHash || '').trim();
  if (!sid || !snapId || !version || !ctxHash) return { success: false, enqueued: false, error: 'invalid_job_payload' };

  const jobKey = buildJobKey({ sessionId: sid, snapshotVersion: version, contextHash: ctxHash });
  const id = crypto.randomUUID();
  const maxA = Math.max(1, Number(maxAttempts || DEFAULT_MAX_ATTEMPTS));
  try {
    const out = db.prepare(`
      INSERT OR IGNORE INTO reasoning_jobs (
        id, session_id, snapshot_id, snapshot_version, context_hash, input_hash, job_key,
        status, attempts, max_attempts, run_at, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      id,
      sid,
      snapId,
      version,
      ctxHash,
      String(inputHash || '').trim() || null,
      jobKey,
      maxA,
      JSON.stringify(payload || {})
    );
    if (!out.changes) {
      Metrics.increment('reasoning.worker.dedupe.count', 1);
      return { success: true, enqueued: false, duplicate: true, job_key: jobKey };
    }
    Metrics.increment('reasoning.worker.enqueued.count', 1);
    return { success: true, enqueued: true, duplicate: false, job_id: id, job_key: jobKey };
  } catch (e) {
    return { success: false, enqueued: false, error: e.message || 'enqueue_failed' };
  }
}

function claimNextReasoningJob(workerId = 'reasoning-worker') {
  const run = db.transaction(() => {
    const row = db.prepare(`
      SELECT id, session_id, snapshot_id, snapshot_version, context_hash, input_hash, job_key,
             status, attempts, max_attempts, run_at, payload_json
      FROM reasoning_jobs
      WHERE status IN ('queued', 'retry')
        AND datetime(run_at) <= datetime('now')
      ORDER BY datetime(run_at) ASC, created_at ASC
      LIMIT 1
    `).get();
    if (!row) return null;
    const updated = db.prepare(`
      UPDATE reasoning_jobs
      SET status = 'started',
          locked_by = ?,
          locked_at = CURRENT_TIMESTAMP,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          heartbeat_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status IN ('queued', 'retry')
    `).run(String(workerId || 'reasoning-worker'), row.id);
    if (!updated.changes) return null;
    return row;
  });

  const claimed = run();
  if (!claimed) return null;
  Metrics.increment('reasoning.worker.started.count', 1);
  let payload = {};
  try { payload = JSON.parse(String(claimed.payload_json || '{}')); } catch (_) {}
  return { ...claimed, payload };
}

function markReasoningJobSuccess(jobId, opts = null) {
  const id = String(jobId || '').trim();
  if (!id) return { success: false };
  const executionSummary =
    opts != null &&
    typeof opts === 'object' &&
    opts.executionSummary != null &&
    typeof opts.executionSummary === 'object'
      ? opts.executionSummary
      : null;
  if (executionSummary) {
    const row = db.prepare(`SELECT payload_json FROM reasoning_jobs WHERE id = ?`).get(id);
    let payload = {};
    try {
      payload = JSON.parse(String(row?.payload_json || '{}'));
    } catch (_) {
      payload = {};
    }
    payload.execution_summary = { ...(payload.execution_summary || {}), ...executionSummary, recorded_at: nowIso() };
    const out = db.prepare(`
      UPDATE reasoning_jobs
      SET status = 'success',
          finished_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          payload_json = ?
      WHERE id = ?
    `).run(JSON.stringify(payload), id);
    if (out.changes) Metrics.increment('reasoning.worker.success.count', 1);
    return { success: out.changes > 0 };
  }
  const out = db.prepare(`
    UPDATE reasoning_jobs
    SET status = 'success',
        finished_at = CURRENT_TIMESTAMP,
        last_error = NULL,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
  if (out.changes) Metrics.increment('reasoning.worker.success.count', 1);
  return { success: out.changes > 0 };
}

function markReasoningJobCancelled(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return { success: false };
  const out = db.prepare(`
    UPDATE reasoning_jobs
    SET status = 'cancelled',
        finished_at = CURRENT_TIMESTAMP,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('queued', 'retry', 'started')
  `).run(id);
  return { success: out.changes > 0 };
}

/** Terminal status for superseded lineage (snapshot moved on; do not retry). */
function markReasoningJobObsolete(jobId, reason = 'obsolete') {
  const id = String(jobId || '').trim();
  if (!id) return { success: false };
  const note = String(reason || 'obsolete').slice(0, 1200);
  const out = db.prepare(`
    UPDATE reasoning_jobs
    SET status = 'obsolete',
        finished_at = CURRENT_TIMESTAMP,
        last_error = ?,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('queued', 'retry', 'started')
  `).run(note, id);
  if (out.changes) Metrics.increment('reasoning.worker.obsolete.count', 1);
  return { success: out.changes > 0 };
}

function _nextRetryDelayMs(attempt) {
  const a = Math.max(0, Number(attempt || 0));
  const jitter = Math.floor(Math.random() * 250);
  return DEFAULT_RETRY_BASE_MS * (2 ** a) + jitter;
}

function markReasoningJobRetryOrDlq(jobId, errorMessage) {
  const id = String(jobId || '').trim();
  if (!id) return { success: false, action: 'invalid' };
  const row = db.prepare(`
    SELECT id, attempts, max_attempts
    FROM reasoning_jobs
    WHERE id = ?
    LIMIT 1
  `).get(id);
  if (!row) return { success: false, action: 'missing' };

  const attempts = Number(row.attempts || 0) + 1;
  const maxAttempts = Math.max(1, Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS));
  const err = String(errorMessage || 'reasoning_job_failed').slice(0, 1200);
  if (attempts >= maxAttempts) {
    const out = db.prepare(`
      UPDATE reasoning_jobs
      SET status = 'dlq',
          attempts = ?,
          finished_at = CURRENT_TIMESTAMP,
          last_error = ?,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(attempts, err, id);
    if (out.changes) Metrics.increment('reasoning.worker.dlq.count', 1);
    return { success: out.changes > 0, action: 'dlq', attempts };
  }

  const delayMs = _nextRetryDelayMs(attempts);
  const delaySeconds = Math.max(1, Math.ceil(delayMs / 1000));
  const out = db.prepare(`
    UPDATE reasoning_jobs
    SET status = 'retry',
        attempts = ?,
        run_at = datetime('now', '+' || ? || ' seconds'),
        last_error = ?,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(attempts, String(delaySeconds), err, id);
  if (out.changes) Metrics.increment('reasoning.worker.retry.count', 1);
  return { success: out.changes > 0, action: 'retry', attempts, retry_in_ms: delayMs };
}

function listReasoningJobs({ status = '', limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit || 50)));
  const s = String(status || '').trim().toLowerCase();
  const rows = s
    ? db.prepare(`
      SELECT *
      FROM reasoning_jobs
      WHERE status = ?
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(s, lim)
    : db.prepare(`
      SELECT *
      FROM reasoning_jobs
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(lim);
  return rows.map((r) => {
    let payload = {};
    try { payload = JSON.parse(String(r.payload_json || '{}')); } catch (_) {}
    return { ...r, payload };
  });
}

function replayReasoningJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return { success: false };
  const out = db.prepare(`
    UPDATE reasoning_jobs
    SET status = 'queued',
        attempts = 0,
        run_at = CURRENT_TIMESTAMP,
        finished_at = NULL,
        started_at = NULL,
        locked_by = NULL,
        locked_at = NULL,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status IN ('dlq', 'cancelled')
  `).run(id);
  return { success: out.changes > 0 };
}

/**
 * Keep `started` jobs alive while long model/merge work runs (watchdog compares heartbeat_at).
 */
function touchReasoningJobHeartbeat(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return { success: false };
  const out = db.prepare(`
    UPDATE reasoning_jobs
    SET heartbeat_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'started'
  `).run(id);
  return { success: out.changes > 0 };
}

/**
 * Jobs stuck in `started` (worker crash / deploy) with no recent heartbeat: re-queue without burning an attempt.
 */
function reclaimStuckStartedReasoningJobs(opts = {}) {
  const olderThanMinutes = Math.max(
    1,
    Number(opts.olderThanMinutes != null ? opts.olderThanMinutes : process.env.REASONING_JOB_STUCK_AFTER_MINUTES || 30)
  );
  const dryRun = !!opts.dryRun;
  const offset = `-${Math.floor(olderThanMinutes)} minutes`;
  const rows = db.prepare(`
    SELECT id, session_id, snapshot_id, status,
           heartbeat_at, locked_at, started_at, created_at
    FROM reasoning_jobs
    WHERE status = 'started'
      AND datetime(COALESCE(heartbeat_at, locked_at, started_at, created_at)) <= datetime('now', ?)
  `).all(offset);
  if (dryRun || !rows.length) {
    return { reclaimed: 0, dry_run: dryRun, candidates: rows.length, job_ids: rows.map((r) => r.id) };
  }
  const upd = db.prepare(`
    UPDATE reasoning_jobs
    SET status = 'retry',
        run_at = CURRENT_TIMESTAMP,
        last_error = 'stuck_started_reclaimed',
        locked_by = NULL,
        locked_at = NULL,
        heartbeat_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'started'
  `);
  let reclaimed = 0;
  for (const row of rows) {
    const out = upd.run(row.id);
    if (out.changes) {
      reclaimed += 1;
      try {
        Metrics.increment('reasoning.worker.stuck_reclaim.count', 1);
      } catch (_) {}
    }
  }
  return { reclaimed, dry_run: false, candidates: rows.length, job_ids: rows.map((r) => r.id) };
}

module.exports = {
  nowIso,
  buildJobKey,
  enqueueReasoningJob,
  claimNextReasoningJob,
  markReasoningJobSuccess,
  markReasoningJobRetryOrDlq,
  markReasoningJobCancelled,
  markReasoningJobObsolete,
  listReasoningJobs,
  replayReasoningJob,
  touchReasoningJobHeartbeat,
  reclaimStuckStartedReasoningJobs
};
