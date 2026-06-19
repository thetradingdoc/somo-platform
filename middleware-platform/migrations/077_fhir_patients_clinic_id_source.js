'use strict';

function addColumnIfMissing(db, table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  const table = 'fhir_patients';
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  addColumnIfMissing(db, table, 'clinic_id_source', 'clinic_id_source TEXT');

  // Mark rows where phone maps to multiple distinct clinics in appointments.
  try {
    const ambiguous = db
      .prepare(
        `SELECT fp.resource_id
         FROM fhir_patients fp
         WHERE fp.phone IS NOT NULL AND fp.phone != ''
           AND (
             SELECT COUNT(DISTINCT a.clinic_id)
             FROM appointments a
             WHERE a.patient_phone = fp.phone AND a.clinic_id IS NOT NULL
           ) > 1`
      )
      .all();
    const mark = db.prepare(`UPDATE fhir_patients SET clinic_id_source = 'backfill_ambiguous' WHERE resource_id = ?`);
    for (const row of ambiguous) {
      mark.run(row.resource_id);
    }
  } catch (_) {
    /* appointments table may be absent in minimal test DBs */
  }
}

function down() {}

module.exports = { up, down };
