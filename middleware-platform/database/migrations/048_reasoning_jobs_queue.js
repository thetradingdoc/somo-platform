'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasoning_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      snapshot_version INTEGER NOT NULL DEFAULT 0,
      context_hash TEXT,
      input_hash TEXT,
      job_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', -- queued/started/retry/success/dlq/cancelled
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_by TEXT,
      locked_at DATETIME,
      started_at DATETIME,
      finished_at DATETIME,
      last_error TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reasoning_jobs_job_key ON reasoning_jobs(job_key);
    CREATE INDEX IF NOT EXISTS idx_reasoning_jobs_status_run ON reasoning_jobs(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_reasoning_jobs_session_created ON reasoning_jobs(session_id, created_at DESC);
  `);
}

module.exports = { up };
