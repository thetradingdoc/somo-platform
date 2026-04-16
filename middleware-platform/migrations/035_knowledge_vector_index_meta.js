'use strict';

/**
 * C6 — Ops table for vector pipeline freshness (used by vector-index-ops + sync script).
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_vector_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function down(db) {
  try {
    db.exec('DROP TABLE IF EXISTS knowledge_vector_index_meta');
  } catch (_) {}
}

module.exports = { up, down };
