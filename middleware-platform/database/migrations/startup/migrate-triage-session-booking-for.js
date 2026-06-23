'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateTriageSessionBookingFor(db) {
  try {
    const info = db.prepare("PRAGMA table_info(triage_sessions)").all();
    const cols = info.map((c) => c.name);
    if (!cols.includes('booking_for')) {
      db.exec('ALTER TABLE triage_sessions ADD COLUMN booking_for TEXT');
      dbLog('✅ Migration: triage_sessions.booking_for added');
    }
  } catch (e) {
    console.warn('⚠️  triage_sessions.booking_for migration failed:', e.message);
  }
}

// ============================================
// MIGRATION: Add cost columns to voice_call_log
// ============================================

