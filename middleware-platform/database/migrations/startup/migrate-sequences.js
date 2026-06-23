'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateSequences(db) {
  try {
    db.pragma('foreign_keys = OFF');

    // Check if sequences table exists
    const sequencesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sequences'").get();
    if (!sequencesTable) {
      dbLog('🔄 Migrating: Creating sequences and sequence_executions tables');
      db.exec(`
        CREATE TABLE IF NOT EXISTS sequences (
          id TEXT PRIMARY KEY,
          merchant_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          steps_json TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        );

        CREATE TABLE IF NOT EXISTS sequence_executions (
          id TEXT PRIMARY KEY,
          sequence_id TEXT NOT NULL,
          lead_id TEXT NOT NULL,
          current_step INTEGER DEFAULT 0,
          status TEXT DEFAULT 'active',
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          paused_at DATETIME,
          metadata TEXT,
          FOREIGN KEY (sequence_id) REFERENCES sequences(id),
          FOREIGN KEY (lead_id) REFERENCES leads(id)
        );

        CREATE INDEX IF NOT EXISTS idx_sequences_merchant_id ON sequences(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_sequences_enabled ON sequences(enabled);
        CREATE INDEX IF NOT EXISTS idx_sequence_executions_sequence_id ON sequence_executions(sequence_id);
        CREATE INDEX IF NOT EXISTS idx_sequence_executions_lead_id ON sequence_executions(lead_id);
        CREATE INDEX IF NOT EXISTS idx_sequence_executions_status ON sequence_executions(status);
      `);
      dbLog('✅ Migration complete: sequences tables created');
    } else {
      dbLog('✅ Migration skipped: sequences tables already exist');
    }

    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Sequences migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add Phase 1 admin portal columns to leads table

