/**
 * Audit log for operator-initiated lead deletes (survives lead row deletion).
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_lead_deletions (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      clinic_name TEXT,
      deleted_by TEXT DEFAULT 'admin',
      deleted_at TEXT DEFAULT (datetime('now')),
      snapshot_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_admin_lead_deletions_lead_id ON admin_lead_deletions(lead_id);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS admin_lead_deletions');
}

module.exports = { up, down };
