'use strict';

/**
 * Phase 0 §6 Key and Secret Management
 * - Secret access audit trail
 * - Scoped service-to-service credentials
 * - Secret rotation registry
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secret_access_audit (
      id TEXT PRIMARY KEY,
      secret_name TEXT NOT NULL,
      consumer TEXT,
      access_context TEXT,
      result TEXT NOT NULL, -- allowed|denied|missing|error
      source TEXT, -- env|gcp_sm|azure_kv|vault|unknown
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_secret_access_audit_name_created
      ON secret_access_audit(secret_name, created_at DESC);

    CREATE TABLE IF NOT EXISTS service_credentials (
      id TEXT PRIMARY KEY,
      service_name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active', -- active|revoked
      created_by TEXT,
      expires_at DATETIME,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_service_credentials_service_status
      ON service_credentials(service_name, status);

    CREATE TABLE IF NOT EXISTS secret_rotation_registry (
      id TEXT PRIMARY KEY,
      secret_name TEXT NOT NULL UNIQUE,
      owner TEXT,
      rotation_interval_days INTEGER NOT NULL DEFAULT 90,
      last_rotated_at DATETIME,
      next_rotation_due_at DATETIME,
      emergency_runbook_url TEXT,
      custody_notes TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_secret_rotation_due
      ON secret_rotation_registry(next_rotation_due_at);
  `);
}

module.exports = { up };

