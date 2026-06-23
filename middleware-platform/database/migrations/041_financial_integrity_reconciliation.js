'use strict';

/**
 * Phase 0 financial integrity foundation:
 * - Canonical ledger events
 * - Deterministic reconciliation job runs
 * - Mismatch classification + exception queue
 * - Daily financial close reports
 * - Immutable reconciliation snapshots
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_events_canonical (
      id TEXT PRIMARY KEY,
      event_group_id TEXT,
      event_key TEXT NOT NULL,
      event_type TEXT NOT NULL, -- authorization|capture|settlement|refund|dispute|adjustment
      source_system TEXT NOT NULL, -- internal|provider_report|processor
      external_ref_type TEXT,
      external_ref_id TEXT,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT, -- pending|posted|settled|failed|disputed|reversed
      occurred_at DATETIME NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_system, event_key, event_type)
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_events_canonical_event_key
      ON ledger_events_canonical(event_key);
    CREATE INDEX IF NOT EXISTS idx_ledger_events_canonical_occurred_at
      ON ledger_events_canonical(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_events_canonical_type
      ON ledger_events_canonical(event_type);

    CREATE TABLE IF NOT EXISTS provider_reconciliation_rows (
      id TEXT PRIMARY KEY,
      provider_report_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT,
      settled_at DATETIME,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_report_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_provider_recon_rows_report
      ON provider_reconciliation_rows(provider_report_id);

    CREATE TABLE IF NOT EXISTS processor_reconciliation_rows (
      id TEXT PRIMARY KEY,
      processor_name TEXT NOT NULL,
      event_key TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT,
      settled_at DATETIME,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(processor_name, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_processor_recon_rows_processor
      ON processor_reconciliation_rows(processor_name);

    CREATE TABLE IF NOT EXISTS reconciliation_job_runs (
      id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL, -- deterministic_reconciliation
      window_start DATETIME NOT NULL,
      window_end DATETIME NOT NULL,
      deterministic_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'running', -- running|completed|failed
      input_hash TEXT,
      mismatch_count INTEGER NOT NULL DEFAULT 0,
      unresolved_count INTEGER NOT NULL DEFAULT 0,
      total_delta REAL NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_recon_job_runs_window
      ON reconciliation_job_runs(window_start, window_end);

    CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      event_key TEXT NOT NULL,
      classification TEXT NOT NULL, -- amount_mismatch|status_mismatch|missing_internal|missing_provider|missing_processor|currency_mismatch
      severity TEXT NOT NULL DEFAULT 'medium', -- low|medium|high|critical
      internal_amount REAL,
      provider_amount REAL,
      processor_amount REAL,
      delta REAL,
      status TEXT NOT NULL DEFAULT 'open', -- open|acknowledged|resolved|ignored
      owner TEXT,
      sla_due_at DATETIME,
      resolved_at DATETIME,
      resolution_note TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES reconciliation_job_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_recon_exceptions_status
      ON reconciliation_exceptions(status, sla_due_at);
    CREATE INDEX IF NOT EXISTS idx_recon_exceptions_event_key
      ON reconciliation_exceptions(event_key);

    CREATE TABLE IF NOT EXISTS financial_close_reports (
      id TEXT PRIMARY KEY,
      close_date DATE NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'USD',
      total_authorizations REAL NOT NULL DEFAULT 0,
      total_captures REAL NOT NULL DEFAULT 0,
      total_settlements REAL NOT NULL DEFAULT 0,
      total_refunds REAL NOT NULL DEFAULT 0,
      total_disputes REAL NOT NULL DEFAULT 0,
      pending_amount REAL NOT NULL DEFAULT 0,
      failed_settlement_amount REAL NOT NULL DEFAULT 0,
      unexplained_delta_amount REAL NOT NULL DEFAULT 0,
      unexplained_delta_count INTEGER NOT NULL DEFAULT 0,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      snapshot_type TEXT NOT NULL, -- job_input|job_output|daily_close
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL UNIQUE,
      previous_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES reconciliation_job_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_recon_snapshots_run
      ON reconciliation_snapshots(run_id, created_at);

    CREATE TRIGGER IF NOT EXISTS trg_reconciliation_snapshots_no_update
    BEFORE UPDATE ON reconciliation_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'reconciliation_snapshots are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_reconciliation_snapshots_no_delete
    BEFORE DELETE ON reconciliation_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'reconciliation_snapshots are immutable');
    END;
  `);
}

function down(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_reconciliation_snapshots_no_delete;
    DROP TRIGGER IF EXISTS trg_reconciliation_snapshots_no_update;
    DROP TABLE IF EXISTS reconciliation_snapshots;
    DROP TABLE IF EXISTS financial_close_reports;
    DROP TABLE IF EXISTS reconciliation_exceptions;
    DROP TABLE IF EXISTS reconciliation_job_runs;
    DROP TABLE IF EXISTS processor_reconciliation_rows;
    DROP TABLE IF EXISTS provider_reconciliation_rows;
    DROP TABLE IF EXISTS ledger_events_canonical;
  `);
}

module.exports = { up, down };
