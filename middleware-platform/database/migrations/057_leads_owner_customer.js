/**
 * Optional owner_customer_id on leads for tenant-partitioned CRM.
 */

function addColumnIfMissing(db, table, col, ddl) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  addColumnIfMissing(db, 'leads', 'owner_customer_id', 'owner_customer_id TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_owner_customer ON leads(owner_customer_id)`);
}

function down(db) {}

module.exports = { up, down };
