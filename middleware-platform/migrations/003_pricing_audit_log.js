/**
 * Task 54: Audit log for admin pricing changes.
 * Table for pricing-specific audit trail (or reuse audit_log with target_type='visit_pricing').
 */
async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_role TEXT,
      clinic_id TEXT NOT NULL,
      appointment_type TEXT NOT NULL,
      action TEXT NOT NULL,
      old_base_price REAL,
      new_base_price REAL,
      old_surge_multiplier REAL,
      new_surge_multiplier REAL,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pricing_audit_clinic ON pricing_audit_log(clinic_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pricing_audit_created ON pricing_audit_log(created_at)');
}

async function down(db) {
  db.exec('DROP TABLE IF EXISTS pricing_audit_log');
}

module.exports = { up, down };
