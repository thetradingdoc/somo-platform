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
  addColumnIfMissing(db, 'voice_agent_settings', 'overflow_enabled', 'overflow_enabled INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'voice_agent_settings', 'porting_status', "porting_status TEXT DEFAULT 'not_started'");
  addColumnIfMissing(db, 'clinics', 'overflow_phone', 'overflow_phone TEXT');
}

function down() {}

module.exports = { up, down };
