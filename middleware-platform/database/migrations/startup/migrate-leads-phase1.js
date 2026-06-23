'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateLeadsPhase1(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(leads)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('auto_qualified')) {
      dbLog('🔄 Migrating: Adding auto_qualified column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN auto_qualified INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('qualified_at')) {
      dbLog('🔄 Migrating: Adding qualified_at column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN qualified_at DATETIME").run();
    }

    if (!columnNames.includes('last_score_update')) {
      dbLog('🔄 Migrating: Adding last_score_update column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN last_score_update DATETIME").run();
    }

    db.pragma('foreign_keys = ON');
    dbLog('✅ Migration complete: Phase 1 columns added to leads');
  } catch (error) {
    console.warn('⚠️  Leads Phase 1 migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add password_hash column to customers table

