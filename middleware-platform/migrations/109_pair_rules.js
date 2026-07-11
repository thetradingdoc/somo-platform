'use strict';

/**
 * NCCI procedure-to-procedure (PTP) edit rules (BL-01).
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pair_rules (
      id TEXT PRIMARY KEY,
      column1_code TEXT NOT NULL,
      column2_code TEXT NOT NULL,
      modifier_indicator INTEGER DEFAULT 1,
      reason TEXT,
      rule_type TEXT DEFAULT 'ncci_ptp',
      effective_date TEXT,
      source_file TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pair_rules_column1 ON pair_rules(column1_code);
    CREATE INDEX IF NOT EXISTS idx_pair_rules_column2 ON pair_rules(column2_code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pair_rules_pair ON pair_rules(column1_code, column2_code);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS pair_rules');
}

module.exports = { up, down };
