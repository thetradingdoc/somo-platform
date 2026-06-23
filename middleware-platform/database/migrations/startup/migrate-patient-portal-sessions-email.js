'use strict';

const { dbLog } = require('../../log');

module.exports = function migratePatientPortalSessionsEmail(db) {
  try {
    // Temporarily disable foreign keys for migration
    db.pragma('foreign_keys = OFF');

    const portalSessionsInfo = db.prepare(`PRAGMA table_info(patient_portal_sessions)`).all();
    const hasEmail = portalSessionsInfo.some(col => col.name === 'email');

    if (!hasEmail) {
      dbLog('📦 Adding email column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN email TEXT;`);
      // Create index for email column
      db.exec(`CREATE INDEX IF NOT EXISTS idx_portal_sessions_email ON patient_portal_sessions(email);`);
      dbLog('✅ Migration complete: email column added to patient_portal_sessions');
    } else {
      // Ensure index exists even if column already exists
      db.exec(`CREATE INDEX IF NOT EXISTS idx_portal_sessions_email ON patient_portal_sessions(email);`);
    }

    // Re-enable foreign keys after migration
    db.pragma('foreign_keys = ON');
  } catch (migrationError) {
    console.warn('⚠️  Patient portal sessions email migration failed:', migrationError.message);
    // Re-enable foreign keys even if migration fails
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add security metadata columns to patient_portal_sessions if they don't exist

