'use strict';

/**
 * 018 — Add patient external identity map + EHR sync job queue
 *
 * This enables deterministic crosswalk:
 *   internal patient_id (FHIR resource_id) <-> external EHR IDs (Athena/Epic/etc).
 * Also adds a durable queue table for lifecycle-triggered EHR sync jobs.
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_external_ids (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      source_system TEXT NOT NULL,        -- athena|epic|1up|custom
      tenant_id TEXT NOT NULL,            -- clinic/site/tenant scope
      external_patient_id TEXT NOT NULL,  -- remote EHR patient ID
      mrn TEXT,
      status TEXT DEFAULT 'active',       -- active|merged|deprecated
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_external_ids_unique
      ON patient_external_ids(source_system, tenant_id, external_patient_id);
    CREATE INDEX IF NOT EXISTS idx_patient_external_ids_patient
      ON patient_external_ids(patient_id);
    CREATE INDEX IF NOT EXISTS idx_patient_external_ids_source_tenant
      ON patient_external_ids(source_system, tenant_id);

    CREATE TABLE IF NOT EXISTS ehr_sync_jobs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,           -- appointment_created|video_started|video_ended|note_signed
      patient_id TEXT NOT NULL,
      appointment_id TEXT,
      source_system TEXT NOT NULL,        -- athena|epic|1up|custom
      tenant_id TEXT NOT NULL,
      payload_json TEXT,
      status TEXT DEFAULT 'queued',       -- queued|in_progress|done|dead
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 5,
      run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ehr_sync_jobs_status_run
      ON ehr_sync_jobs(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_ehr_sync_jobs_patient
      ON ehr_sync_jobs(patient_id, created_at);
  `);
}

function down() {
  // no-op: destructive down migrations intentionally omitted for SQLite safety
}

module.exports = { up, down };

