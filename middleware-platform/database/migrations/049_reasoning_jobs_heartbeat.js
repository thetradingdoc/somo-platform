'use strict';

function up(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info(reasoning_jobs)`).all();
    const has = new Set(cols.map((c) => c.name));
    if (!has.has('heartbeat_at')) {
      db.exec(`ALTER TABLE reasoning_jobs ADD COLUMN heartbeat_at DATETIME;`);
    }
  } catch (_) {
    // no-op
  }
}

module.exports = { up };
