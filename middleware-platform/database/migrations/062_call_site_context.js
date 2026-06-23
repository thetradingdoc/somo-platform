'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_site_context (
      call_id TEXT PRIMARY KEY,
      session_id TEXT,
      to_number TEXT,
      customer_id TEXT,
      clinic_id TEXT,
      merchant_id TEXT,
      location_id TEXT,
      clinic_id_source TEXT,
      site_context_status TEXT NOT NULL,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_call_site_context_clinic ON call_site_context(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_call_site_context_customer ON call_site_context(customer_id);
    CREATE INDEX IF NOT EXISTS idx_call_site_context_status ON call_site_context(site_context_status);
  `);
}

function down() {}

module.exports = { up, down };
