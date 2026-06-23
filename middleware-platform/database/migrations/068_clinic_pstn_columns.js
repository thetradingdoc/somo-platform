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
  addColumnIfMissing(db, 'clinics', 'transfer_number', 'transfer_number TEXT');
  addColumnIfMissing(db, 'clinics', 'fallback_pstn', 'fallback_pstn TEXT');
}

function down() {}

module.exports = { up, down };
