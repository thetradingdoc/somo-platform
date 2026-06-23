/**
 * RCM-PA v1: Prior authorization case tracking table + appointment PA fields.
 *
 * - Adds appointment-level fields so patient/provider can see PA state.
 * - Creates `prior_auth_requests` as the system of record for case-level PA.
 */

function up(db) {
  // --- appointments: add PA fields
  const apptCols = db.prepare(`PRAGMA table_info(appointments)`).all();
  const hasRequires = apptCols.some((c) => c.name === 'requires_prior_auth');
  const hasAuthStatus = apptCols.some((c) => c.name === 'auth_status');
  const hasReqId = apptCols.some((c) => c.name === 'prior_auth_request_id');

  if (!hasRequires) db.exec(`ALTER TABLE appointments ADD COLUMN requires_prior_auth INTEGER DEFAULT 0;`);
  if (!hasAuthStatus) db.exec(`ALTER TABLE appointments ADD COLUMN auth_status TEXT;`);
  if (!hasReqId) db.exec(`ALTER TABLE appointments ADD COLUMN prior_auth_request_id TEXT;`);

  // --- prior_auth_requests: create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS prior_auth_requests (
      id TEXT PRIMARY KEY,
      appointment_id TEXT,
      claim_id TEXT,
      patient_id TEXT,
      payer_id TEXT,
      member_id TEXT,
      cpt_code TEXT,
      icd10_code TEXT,
      place_of_service TEXT,
      date_of_service TEXT,
      submission_rail TEXT, -- stedi_271_only | uhc_fhir | partner | manual
      status TEXT, -- pending | approved | denied | more_info_needed | cancelled | not_required | unknown
      tracking_number TEXT,
      auth_number TEXT,
      expiry_date TEXT,
      denial_reason TEXT,
      stedi_correlation_id TEXT,
      raw_request_json TEXT,
      raw_response_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_prior_auth_requests_appointment ON prior_auth_requests(appointment_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_prior_auth_requests_patient ON prior_auth_requests(patient_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_prior_auth_requests_status ON prior_auth_requests(status);`);
}

module.exports = { up };

