/**
 * Telemedicine Phase 2 — Data layer.
 * Tasks 14–18: patient_uploads, upload_tokens, fhir_diagnostic_reports additions, appointments reminder flags.
 */
function up(db) {
  // -------- Task 14: patient_uploads --------
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_uploads (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      appointment_id TEXT,
      encounter_id TEXT,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_type TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      source TEXT DEFAULT 'portal',
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      uploaded_by TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_patient_uploads_patient ON patient_uploads(patient_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_patient_uploads_appointment ON patient_uploads(appointment_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_patient_uploads_uploaded_at ON patient_uploads(uploaded_at)');

  // -------- Task 15: upload_tokens --------
  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_tokens (
      token TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      appointment_id TEXT,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      max_files INTEGER DEFAULT 10,
      max_bytes INTEGER DEFAULT 52428800,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_upload_tokens_patient ON upload_tokens(patient_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires ON upload_tokens(expires_at)');

  // -------- Task 16 & 17: fhir_diagnostic_reports schema + indexes --------
  const drInfo = db.prepare('PRAGMA table_info(fhir_diagnostic_reports)').all();
  const drNames = drInfo.map(c => c.name);

  if (!drNames.includes('status')) {
    db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN status TEXT DEFAULT 'pending'`);
  }
  if (!drNames.includes('case_report_text')) {
    db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN case_report_text TEXT`);
  }
  if (!drNames.includes('reasoning_chain')) {
    db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN reasoning_chain TEXT`);
  }
  if (!drNames.includes('pdf_url')) {
    db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN pdf_url TEXT`);
  }
  if (!drNames.includes('job_id')) {
    db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN job_id TEXT`);
  }
  if (!drNames.includes('error_message')) {
    db.exec(`ALTER TABLE fhir_diagnostic_reports ADD COLUMN error_message TEXT`);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_fhir_dr_encounter ON fhir_diagnostic_reports(encounter_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_fhir_dr_patient ON fhir_diagnostic_reports(patient_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_fhir_dr_status ON fhir_diagnostic_reports(status)');

  // -------- Task 18: appointments reminder flag columns --------
  const apptInfo = db.prepare('PRAGMA table_info(appointments)').all();
  const apptNames = apptInfo.map(c => c.name);

  if (!apptNames.includes('reminder_booking_sent')) {
    db.exec(`ALTER TABLE appointments ADD COLUMN reminder_booking_sent INTEGER DEFAULT 0`);
  }
  if (!apptNames.includes('reminder_24h_sent')) {
    db.exec(`ALTER TABLE appointments ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0`);
  }
  // D4: Use existing reminder_sent for 1h reminders; do NOT add reminder_1h_sent

  // Index to support reminder scheduler windowed queries by time/status/reminder_sent
  db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_start_status_reminder ON appointments(start_time, status, reminder_sent)');
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS patient_uploads');
  db.exec('DROP TABLE IF EXISTS upload_tokens');
  db.exec('DROP INDEX IF EXISTS idx_fhir_dr_encounter');
  db.exec('DROP INDEX IF EXISTS idx_fhir_dr_patient');
  db.exec('DROP INDEX IF EXISTS idx_fhir_dr_status');
}

module.exports = { up, down };
