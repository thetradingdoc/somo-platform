/**
 * Telemedicine Phase 1 — Task 5: audit_log schema for compliance.
 * Adds columns required by TELEMEDICINE_TODOS: resource_type, resource_id, ip_address, result, timestamp.
 * Existing columns (target_type, target_id, ip, details, created_at) remain for backward compatibility.
 */
function up(db) {
  const columns = db.prepare('PRAGMA table_info(audit_log)').all();
  const names = columns.map(c => c.name);

  if (!names.includes('resource_type')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN resource_type TEXT');
  }
  if (!names.includes('resource_id')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN resource_id TEXT');
  }
  if (!names.includes('ip_address')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN ip_address TEXT');
  }
  if (!names.includes('result')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN result TEXT');
  }
  if (!names.includes('timestamp')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN timestamp DATETIME DEFAULT CURRENT_TIMESTAMP');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)');
}

function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_audit_log_resource');
  db.exec('DROP INDEX IF EXISTS idx_audit_log_timestamp');
}

module.exports = { up, down };
