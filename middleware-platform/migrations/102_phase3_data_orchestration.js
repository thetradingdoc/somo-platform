'use strict';

function addColumnIfMissing(db, table, col, ddl) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  addColumnIfMissing(db, 'clinics', 'office_type', "office_type TEXT DEFAULT 'medical'");
  addColumnIfMissing(db, 'clinics', 'language_pack', "language_pack TEXT DEFAULT 'en'");
  addColumnIfMissing(db, 'clinics', 'e10_digest_last_sent_at', 'e10_digest_last_sent_at TEXT');

  addColumnIfMissing(db, 'fhir_patients', 'clinic_id', 'clinic_id TEXT');
  addColumnIfMissing(db, 'fhir_patients', 'external_ids_json', 'external_ids_json TEXT');
  addColumnIfMissing(db, 'fhir_patients', 'roster_import_key', 'roster_import_key TEXT');

  addColumnIfMissing(db, 'appointments', 'last_eligibility_id', 'last_eligibility_id TEXT');
  addColumnIfMissing(db, 'appointments', 'eligibility_status', 'eligibility_status TEXT');
  addColumnIfMissing(db, 'appointments', 'eligibility_copay_cents', 'eligibility_copay_cents INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pms_sync_queue (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pms_sync_queue_clinic ON pms_sync_queue(clinic_id, status);`);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fhir_roster_import_key
      ON fhir_patients(clinic_id, roster_import_key)
      WHERE roster_import_key IS NOT NULL AND is_deleted = 0;
  `);
}

function down() {}

module.exports = { up, down };
