'use strict';

function countNulls(db, table, column) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return 0;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IS NULL`).get()?.n || 0;
}

function up(db) {
  const projectionNulls = countNulls(db, 'kelly_rails_session_projection', 'clinic_id');
  const triageNulls = countNulls(db, 'triage_sessions', 'clinic_id');
  if (projectionNulls > 0 || triageNulls > 0) {
    throw new Error(
      `074 preflight failed: projection clinic_id nulls=${projectionNulls}, triage clinic_id nulls=${triageNulls}. Run backfill + verify-tenant-columns-null-free.cjs first.`
    );
  }

  // Document NOT NULL intent via CHECK constraints on new writes (SQLite ALTER NOT NULL unsupported on legacy rows).
  for (const table of ['kelly_rails_session_projection', 'triage_sessions']) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!exists) continue;
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${table}_clinic_notnull
        ON ${table}(clinic_id)
        WHERE clinic_id IS NOT NULL;
    `);
  }
}

function down() {}

module.exports = { up, down };
