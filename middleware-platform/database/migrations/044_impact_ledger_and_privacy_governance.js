'use strict';

/**
 * Phase 0 §5/§7 governance foundation:
 * - Impact ledger v1 schema + evidence hash-chain
 * - Data inventory / retention policies
 * - Impact verification sample tracking
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS impact_ledger_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL, -- donation|care_delivery|product_safety|community_action|offset
      subject_type TEXT, -- patient|provider|community|system
      subject_id TEXT,
      provenance_source TEXT, -- user_submission|provider_attestation|partner_feed|system_derived
      verification_state TEXT NOT NULL DEFAULT 'pending', -- pending|verified|rejected
      privacy_classification TEXT NOT NULL DEFAULT 'public_aggregate', -- public_aggregate|internal_sensitive|restricted_phi
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      evidence_json TEXT,
      evidence_hash TEXT,
      previous_evidence_hash TEXT,
      evidence_chain_hash TEXT,
      metadata_json TEXT,
      occurred_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_impact_ledger_type_time
      ON impact_ledger_events(event_type, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_impact_ledger_verification
      ON impact_ledger_events(verification_state, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS impact_verification_samples (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      sampled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewer TEXT,
      expected_state TEXT,
      observed_state TEXT,
      is_false_positive INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY(event_id) REFERENCES impact_ledger_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_impact_verification_samples_event
      ON impact_verification_samples(event_id);

    CREATE TABLE IF NOT EXISTS data_inventory_registry (
      id TEXT PRIMARY KEY,
      system_name TEXT NOT NULL,
      data_domain TEXT NOT NULL, -- payments|impact|identity|ops
      dataset_name TEXT NOT NULL,
      contains_phi INTEGER NOT NULL DEFAULT 0,
      contains_pii INTEGER NOT NULL DEFAULT 0,
      privacy_tier TEXT NOT NULL DEFAULT 'internal',
      retention_days INTEGER NOT NULL DEFAULT 365,
      owner TEXT,
      access_roles_json TEXT,
      redaction_policy TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_data_inventory_unique_dataset
      ON data_inventory_registry(system_name, dataset_name);

    CREATE TABLE IF NOT EXISTS data_retention_jobs (
      id TEXT PRIMARY KEY,
      dataset_name TEXT NOT NULL,
      cutoff_at DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'running', -- running|completed|failed
      records_deleted INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
  `);
}

module.exports = { up };

