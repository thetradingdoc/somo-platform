'use strict';

/**
 * Patient billing portal DDL (H-07). Single entry for billing table creation.
 * @param {{ db: import('better-sqlite3').Database }} sqlite
 */
function ensureBillingTables(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS patient_billing_documents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      source_type TEXT DEFAULT 'upload',
      file_name TEXT,
      mime_type TEXT,
      storage_ref TEXT,
      parse_status TEXT DEFAULT 'queued',
      confidence_score REAL,
      notes TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_billing_docs_session ON patient_billing_documents(session_id, datetime(created_at) DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_docs_patient ON patient_billing_documents(patient_id, datetime(created_at) DESC);

    CREATE TABLE IF NOT EXISTS patient_billing_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      event_type TEXT DEFAULT 'bill',
      title TEXT NOT NULL,
      provider_name TEXT,
      service_date TEXT,
      amount_cents INTEGER,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'needs_review',
      confidence_score REAL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_billing_events_session ON patient_billing_events(session_id, datetime(created_at) DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_events_patient ON patient_billing_events(patient_id, datetime(created_at) DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_events_service_date ON patient_billing_events(service_date);
    CREATE INDEX IF NOT EXISTS idx_billing_events_session_service_date ON patient_billing_events(session_id, service_date);
    CREATE INDEX IF NOT EXISTS idx_billing_events_patient_service_date ON patient_billing_events(patient_id, service_date);

    CREATE TABLE IF NOT EXISTS patient_billing_event_documents (
      id TEXT PRIMARY KEY,
      billing_event_id TEXT NOT NULL,
      billing_document_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(billing_event_id, billing_document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_link_event ON patient_billing_event_documents(billing_event_id);
    CREATE INDEX IF NOT EXISTS idx_billing_link_document ON patient_billing_event_documents(billing_document_id);

    CREATE TABLE IF NOT EXISTS patient_billing_subscriptions (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      patient_id TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TEXT,
      current_period_end TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_billing_subs_session ON patient_billing_subscriptions(session_id, datetime(updated_at) DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_subs_patient ON patient_billing_subscriptions(patient_id, datetime(updated_at) DESC);

    CREATE TABLE IF NOT EXISTS patient_billing_care_episodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      episode_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      start_date TEXT,
      end_date TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, episode_key)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_episodes_session ON patient_billing_care_episodes(session_id, datetime(updated_at) DESC);

    CREATE TABLE IF NOT EXISTS patient_billing_episode_events (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL,
      billing_event_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(episode_id, billing_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_episode_events_episode ON patient_billing_episode_events(episode_id);
    CREATE INDEX IF NOT EXISTS idx_billing_episode_events_event ON patient_billing_episode_events(billing_event_id);

    CREATE TABLE IF NOT EXISTS patient_billing_payment_attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      billing_event_id TEXT,
      amount_cents INTEGER,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'queued',
      decline_reason TEXT,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_billing_payment_attempts_session ON patient_billing_payment_attempts(session_id, datetime(attempted_at) DESC);

    CREATE TABLE IF NOT EXISTS patient_billing_coverage_contexts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      coverage_type TEXT,
      deductible_total_cents INTEGER,
      deductible_used_cents INTEGER,
      oop_total_cents INTEGER,
      oop_used_cents INTEGER,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_billing_coverage_session ON patient_billing_coverage_contexts(session_id, datetime(updated_at) DESC);

    CREATE TABLE IF NOT EXISTS patient_billing_retention_policies (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      retain_days INTEGER DEFAULT 365,
      auto_delete_enabled INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_billing_retention_session ON patient_billing_retention_policies(session_id, datetime(updated_at) DESC);

    CREATE TABLE IF NOT EXISTS patient_billing_deletion_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      status TEXT DEFAULT 'queued',
      reason TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_billing_deletion_session ON patient_billing_deletion_requests(session_id, datetime(requested_at) DESC);
  `);
}

module.exports = { ensureBillingTables };
