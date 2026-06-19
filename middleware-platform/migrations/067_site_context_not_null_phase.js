'use strict';

/**
 * SITE-25 phase 2 — NOT NULL enforced at application layer first; schema documents intent.
 * SQLite cannot easily ALTER NOT NULL on existing columns with nulls.
 */

function up(db) {
  // Indexes only; app gates writes until backfill complete
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_call_site_context_verified
      ON call_site_context(site_context_status, verified_at DESC)
      WHERE site_context_status = 'verified';
  `);
}

function down() {}

module.exports = { up, down };
