'use strict';

const { dbLog } = require('../../log');

module.exports = function migratePatientPortalSessionsSecurityMeta(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const cols = db.prepare(`PRAGMA table_info(patient_portal_sessions)`).all();
    const hasIp = cols.some((c) => c.name === 'ip_address');
    const hasUa = cols.some((c) => c.name === 'user_agent');
    const hasFailed = cols.some((c) => c.name === 'failed_attempts');
    const hasLocked = cols.some((c) => c.name === 'locked_until');
    const hasLastSeen = cols.some((c) => c.name === 'last_seen_at');
    const hasRevokedAt = cols.some((c) => c.name === 'revoked_at');
    const hasRotatedTo = cols.some((c) => c.name === 'rotated_to');

    if (!hasIp) {
      dbLog('📦 Adding ip_address column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN ip_address TEXT;`);
    }
    if (!hasUa) {
      dbLog('📦 Adding user_agent column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN user_agent TEXT;`);
    }
    if (!hasFailed) {
      dbLog('📦 Adding failed_attempts column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN failed_attempts INTEGER DEFAULT 0;`);
    }
    if (!hasLocked) {
      dbLog('📦 Adding locked_until column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN locked_until DATETIME;`);
    }
    if (!hasLastSeen) {
      dbLog('📦 Adding last_seen_at column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN last_seen_at DATETIME;`);
    }
    if (!hasRevokedAt) {
      dbLog('📦 Adding revoked_at column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN revoked_at DATETIME;`);
    }
    if (!hasRotatedTo) {
      dbLog('📦 Adding rotated_to column to patient_portal_sessions table...');
      db.exec(`ALTER TABLE patient_portal_sessions ADD COLUMN rotated_to TEXT;`);
    }

    db.pragma('foreign_keys = ON');
  } catch (e) {
    console.warn('⚠️  Patient portal sessions security meta migration failed:', e.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add status column to patient_documents (mvp-41)

