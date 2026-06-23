'use strict';

function countNulls(db, table, column) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return 0;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IS NULL`).get()?.n || 0;
}

/** R-07-4 — NOT NULL promotion after backfill (strict preflight). */
function up(db) {
  const checks = [
    ['kelly_rails_session_projection', 'clinic_id'],
    ['triage_sessions', 'clinic_id'],
    ['session_state_projection', 'clinic_id']
  ];
  for (const [table, col] of checks) {
    const n = countNulls(db, table, col);
    if (n > 0) {
      throw new Error(`076 preflight: ${table}.${col} has ${n} null rows — run backfill first`);
    }
  }
}

function down() {}

module.exports = { up, down };
