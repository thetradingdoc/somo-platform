/**
 * M-Doc.2: patient_document_extracts
 * Stores OCR/vision-extracted text from patient documents for RAG query.
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_document_extracts (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      extracted_text TEXT,
      extraction_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (doc_id) REFERENCES patient_documents(id),
      FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_patient_document_extracts_doc ON patient_document_extracts(doc_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_patient_document_extracts_patient ON patient_document_extracts(patient_id)');
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS patient_document_extracts');
}

module.exports = { up, down };
