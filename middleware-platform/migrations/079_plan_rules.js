'use strict';

/** 079 — plan_rules for minimal payer quote model (Session 4) */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_rules (
      id TEXT PRIMARY KEY,
      payer_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      code_pattern TEXT NOT NULL,
      covered INTEGER NOT NULL DEFAULT 1,
      copay_type TEXT NOT NULL DEFAULT 'flat',
      copay_value REAL NOT NULL DEFAULT 0,
      requires_pa INTEGER NOT NULL DEFAULT 0,
      effective_date TEXT,
      rule_version TEXT NOT NULL DEFAULT '1',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_rules_payer_plan ON plan_rules(payer_id, plan_id);
    CREATE INDEX IF NOT EXISTS idx_plan_rules_code ON plan_rules(code_pattern);
  `);
}

function down() {
  console.warn('[079] down: no-op');
}

module.exports = { up, down };
