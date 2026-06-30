/**
 * Soft-delete support for clinics + audit log for tenant deletion.
 */

function up(db) {
  const cols = db.prepare('PRAGMA table_info(clinics)').all().map((c) => c.name);
  if (!cols.includes('archived_at')) {
    db.exec('ALTER TABLE clinics ADD COLUMN archived_at TEXT');
  }
  if (!cols.includes('archived_by')) {
    db.exec('ALTER TABLE clinics ADD COLUMN archived_by TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_tenant_deletions (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      clinic_name TEXT,
      deleted_by TEXT DEFAULT 'admin',
      deleted_at TEXT DEFAULT (datetime('now')),
      mode TEXT NOT NULL DEFAULT 'soft',
      snapshot_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_admin_tenant_deletions_clinic_id ON admin_tenant_deletions(clinic_id);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS admin_tenant_deletions');
}

module.exports = { up, down };
