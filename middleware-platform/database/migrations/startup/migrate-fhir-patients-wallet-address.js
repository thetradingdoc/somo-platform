'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateFHIRPatientsWalletAddress(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(fhir_patients)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('patient_wallet_address')) {
      dbLog('🔄 Migrating: Adding patient_wallet_address column to fhir_patients table');
      db.prepare("ALTER TABLE fhir_patients ADD COLUMN patient_wallet_address TEXT").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_fhir_patients_wallet ON fhir_patients(patient_wallet_address)").run();
      dbLog('✅ Migration complete: patient_wallet_address added for HSA escrow flow');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.error('❌ FHIR patients wallet migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add merged_into marker for patient merges (helps unify identity)

