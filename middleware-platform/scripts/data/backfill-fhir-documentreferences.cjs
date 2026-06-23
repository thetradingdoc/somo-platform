/**
 * Batch 5 migration: backfill fhir_document_references from patient_documents.
 *
 * Usage:
 *   node scripts/data/backfill-fhir-documentreferences.cjs
 *
 * Env:
 *   DB_PATH=./middleware-dev.db
 *   PUBLIC_BASE_URL=http://localhost:4000   (optional)
 */

const db = require('../../database');

function baseUrl() {
  const b = process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
  return String(b).replace(/\/+$/, '');
}

function buildDocRef(row) {
  const patientId = row.patient_id;
  const id = row.id;
  const contentType = row.file_type || 'application/octet-stream';
  const title = row.file_name || 'Document';
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
  const encounterRef = row.encounter_id ? { reference: `Encounter/${row.encounter_id}` } : null;
  const url = `${baseUrl()}/fhir/Binary/${id}`;

  return {
    resourceType: 'DocumentReference',
    id,
    status: 'current',
    subject: patientId ? { reference: `Patient/${patientId}` } : undefined,
    date: createdAt,
    description: title,
    context: encounterRef ? { encounter: [encounterRef] } : undefined,
    content: [{
      attachment: { contentType, title, url }
    }]
  };
}

async function main() {
  const rows = db.db.prepare(`
    SELECT id, patient_id, encounter_id, appointment_id, file_name, file_type, created_at
    FROM patient_documents
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
  `).all();

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = db.getFHIRDocumentReference ? db.getFHIRDocumentReference(r.id) : null;
    if (existing) {
      skipped++;
      continue;
    }
    const dr = buildDocRef(r);
    const ok = db.createFHIRDocumentReference ? db.createFHIRDocumentReference(dr) : null;
    if (ok) created++;
  }

  console.log(JSON.stringify({ ok: true, total_patient_documents: rows.length, created, skipped }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

