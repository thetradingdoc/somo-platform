/**
 * Postgres Sync Retry Worker (Section 2.2 - Middleware Brain Improvements)
 *
 * Polls postgres_sync_retry every 60s, retries with exponential backoff (1s, 2s, 4s, 8s, 16s).
 * After 5 failures, moves to postgres_sync_dlq.
 * Batch size: 10 per run.
 */

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 60 * 1000;
const BATCH_SIZE = 10;

let intervalId = null;

async function processRetryBatch() {
  const db = require('../database');
  const { executePostgresSync, getPendingSyncRetries, updateSyncRetry, deleteSyncRetry, moveToDLQ } = db;

  const rows = getPendingSyncRetries().slice(0, BATCH_SIZE);
  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await executePostgresSync(row.entity_type, row.payload_json);
      deleteSyncRetry(row.id);
    } catch (err) {
      const nextAttempt = (row.attempt_count || 0) + 1;
      updateSyncRetry(row.id, nextAttempt, err.message);

      if (nextAttempt >= MAX_ATTEMPTS) {
        moveToDLQ(row.id);
      }
    }
  }
}

function start() {
  if (intervalId) return;
  intervalId = setInterval(processRetryBatch, POLL_INTERVAL_MS);
  console.log('📋 Postgres sync retry worker started (interval 60s)');
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('📋 Postgres sync retry worker stopped');
  }
}

module.exports = {
  start,
  stop,
  processRetryBatch
};
