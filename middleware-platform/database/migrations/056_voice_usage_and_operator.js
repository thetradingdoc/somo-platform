/**
 * Voice usage direction + operator capabilities on customers.
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
  addColumnIfMissing(db, 'usage_events', 'direction', "direction TEXT DEFAULT 'inbound'");
  addColumnIfMissing(db, 'voice_call_log', 'direction', "direction TEXT DEFAULT 'inbound'");
  addColumnIfMissing(db, 'usage_events', 'channel', "channel TEXT DEFAULT 'voice'");
  addColumnIfMissing(db, 'voice_call_log', 'channel', "channel TEXT DEFAULT 'voice'");
  addColumnIfMissing(db, 'customers', 'capabilities', 'capabilities TEXT');
  addColumnIfMissing(db, 'llm_usage_log', 'customer_id', 'customer_id TEXT');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_direction ON usage_events(direction)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_call_log_direction ON voice_call_log(direction)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_llm_usage_log_customer ON llm_usage_log(customer_id)`);
}

function down(db) {
  // SQLite column drops not supported — no-op
}

module.exports = { up, down };
