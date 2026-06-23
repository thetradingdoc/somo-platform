'use strict';

function up(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(session_result_snapshots)`).all();
    const has = new Set(cols.map((c) => c.name));
    if (!has.has('semantic_contract_version')) {
      db.exec(`ALTER TABLE session_result_snapshots ADD COLUMN semantic_contract_version TEXT;`);
    }
  } catch (_) {
    // no-op
  }
}

module.exports = { up };
