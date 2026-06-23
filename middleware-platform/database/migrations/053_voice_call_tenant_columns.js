/**
 * W2-01: Scope per-call voice state to SaaS customer_id.
 * W2-00: New tenant columns use numbered migrations — do not add inline ALTER in database.js.
 */

function addColumnIfMissing(db, table, col, ddl) {
  const exists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  if (!exists) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  const tables = [
    'voice_call_states',
    'voice_conversation_memory',
    'agent_turns',
    'agent_state_snapshots'
  ];
  for (const table of tables) {
    addColumnIfMissing(db, table, 'customer_id', 'customer_id TEXT');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_customer_id ON ${table}(customer_id)`);
  }
}

function down(db) {
  // SQLite: column drops not supported in older versions — no-op
}

module.exports = { up, down };
