/**
 * Post-call stage suggestion for HITL review (P2-9).
 */

function addColumnIfMissing(db, table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  addColumnIfMissing(db, 'leads', 'suggested_stage', 'suggested_stage TEXT');
  addColumnIfMissing(db, 'leads', 'suggested_stage_note', 'suggested_stage_note TEXT');
}

function down(db) {}

module.exports = { up, down };
