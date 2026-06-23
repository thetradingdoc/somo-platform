/**
 * W3: prompt_synced_at on customers; prompt_profiles.customer_id for SaaS scope.
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
  addColumnIfMissing(db, 'customers', 'prompt_synced_at', 'prompt_synced_at DATETIME');
  addColumnIfMissing(db, 'prompt_profiles', 'customer_id', 'customer_id TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_prompt_profiles_customer_id ON prompt_profiles(customer_id)`);
}

function down(db) {}

module.exports = { up, down };
