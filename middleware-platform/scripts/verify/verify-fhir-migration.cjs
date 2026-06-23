/**
 * Batch 5 verification: basic sanity checks for FHIR backfill.
 *
 * Usage:
 *   node scripts/verify/verify-fhir-migration.cjs
 *
 * Env:
 *   DB_PATH=./middleware-dev.db
 */

const db = require('../../database');

function count(sql, params = []) {
  return db.db.prepare(sql).get(...params)['c'] || 0;
}

async function main() {
  const apptCount = count(`SELECT COUNT(*) as c FROM appointments WHERE deleted_at IS NULL`);
  const encCount = count(`SELECT COUNT(*) as c FROM fhir_encounters WHERE is_deleted = 0`);
  const docCount = count(`SELECT COUNT(*) as c FROM patient_documents WHERE deleted_at IS NULL`);
  const drCount = count(`SELECT COUNT(*) as c FROM fhir_document_references WHERE is_deleted = 0`);

  const missingEnc = db.db.prepare(`
    SELECT a.id FROM appointments a
    LEFT JOIN fhir_encounters e ON e.resource_id = a.id
    WHERE a.deleted_at IS NULL AND a.patient_id IS NOT NULL AND (e.resource_id IS NULL)
    LIMIT 20
  `).all();

  const missingDocRef = db.db.prepare(`
    SELECT d.id FROM patient_documents d
    LEFT JOIN fhir_document_references r ON r.resource_id = d.id
    WHERE d.deleted_at IS NULL AND (r.resource_id IS NULL)
    LIMIT 20
  `).all();

  const out = {
    ok: true,
    counts: {
      appointments: apptCount,
      fhir_encounters: encCount,
      patient_documents: docCount,
      fhir_document_references: drCount
    },
    samples: {
      missing_encounter_for_appointment_ids: missingEnc.map(r => r.id),
      missing_documentreference_for_doc_ids: missingDocRef.map(r => r.id)
    }
  };

  console.log(JSON.stringify(out, null, 2));
  if (missingEnc.length || missingDocRef.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

