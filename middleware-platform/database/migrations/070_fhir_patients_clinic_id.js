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
  addColumnIfMissing(db, 'fhir_patients', 'clinic_id', 'clinic_id TEXT');
  db.exec(`
    DROP INDEX IF EXISTS idx_fhir_patients_phone_active;
    CREATE INDEX IF NOT EXISTS idx_fhir_patients_phone_clinic
      ON fhir_patients(phone, clinic_id)
      WHERE phone IS NOT NULL AND is_deleted = 0;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fhir_patients_phone_default
      ON fhir_patients(phone)
      WHERE phone IS NOT NULL AND is_deleted = 0 AND clinic_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fhir_patients_phone_clinic_unique
      ON fhir_patients(phone, clinic_id)
      WHERE phone IS NOT NULL AND is_deleted = 0 AND clinic_id IS NOT NULL;
  `);

  try {
    db.exec(`
      UPDATE fhir_patients
      SET clinic_id = (
        SELECT a.clinic_id FROM appointments a
        WHERE a.patient_id = fhir_patients.resource_id AND a.clinic_id IS NOT NULL
        ORDER BY a.created_at DESC LIMIT 1
      )
      WHERE clinic_id IS NULL
        AND EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.patient_id = fhir_patients.resource_id AND a.clinic_id IS NOT NULL
        );
    `);
  } catch (_) {}

  try {
    db.exec(`
      UPDATE fhir_patients
      SET clinic_id = (
        SELECT v.clinic_id FROM voice_call_log v
        WHERE v.caller_phone = fhir_patients.phone AND v.clinic_id IS NOT NULL
        ORDER BY v.created_at DESC LIMIT 1
      )
      WHERE clinic_id IS NULL AND phone IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM voice_call_log v
          WHERE v.caller_phone = fhir_patients.phone AND v.clinic_id IS NOT NULL
        );
    `);
  } catch (_) {}
}

function down() {}

module.exports = { up, down };
