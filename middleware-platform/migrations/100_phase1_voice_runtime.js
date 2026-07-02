'use strict';

function addColumnIfMissing(db, table, col, ddl) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  addColumnIfMissing(
    db,
    'voice_agent_settings',
    'coverage_mode',
    "coverage_mode TEXT DEFAULT 'full_replacement'"
  );
  addColumnIfMissing(db, 'voice_agent_settings', 'coverage_hours', 'coverage_hours TEXT');
  addColumnIfMissing(
    db,
    'voice_agent_settings',
    'after_hours_action',
    "after_hours_action TEXT DEFAULT 'message_only'"
  );
  addColumnIfMissing(
    db,
    'voice_agent_settings',
    'ai_disclosure_enabled',
    'ai_disclosure_enabled INTEGER DEFAULT 1'
  );
  addColumnIfMissing(
    db,
    'voice_agent_settings',
    'voice_reply_suppress_enabled',
    'voice_reply_suppress_enabled INTEGER DEFAULT 0'
  );
}

function down() {}

module.exports = { up, down };
