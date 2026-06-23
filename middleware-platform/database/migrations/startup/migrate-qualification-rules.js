'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateQualificationRules(db) {
  try {
    db.pragma('foreign_keys = OFF');

    // Check if qualification_rules table exists
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qualification_rules'").get();
    if (!table) {
      dbLog('🔄 Migrating: Creating qualification_rules table');
      db.exec(`
        CREATE TABLE IF NOT EXISTS qualification_rules (
          id TEXT PRIMARY KEY,
          merchant_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          rules_json TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          priority INTEGER DEFAULT 5,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        );

        CREATE INDEX IF NOT EXISTS idx_qualification_rules_merchant_id ON qualification_rules(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_qualification_rules_enabled ON qualification_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_qualification_rules_priority ON qualification_rules(priority);
      `);
      dbLog('✅ Migration complete: qualification_rules table created');
    } else {
      dbLog('✅ Migration skipped: qualification_rules table already exists');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Qualification rules migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add Phase 2 sequences tables

