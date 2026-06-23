'use strict';

/** 084 — HITL coding_decisions SLA + assignee columns */

function columnNames(db) {
  return new Set(db.prepare('PRAGMA table_info(coding_decisions)').all().map((c) => c.name));
}

function up(db) {
  const cols = columnNames(db);
  if (!cols.has('assignee_id')) {
    db.exec('ALTER TABLE coding_decisions ADD COLUMN assignee_id TEXT;');
  }
  if (!cols.has('sla_deadline')) {
    db.exec('ALTER TABLE coding_decisions ADD COLUMN sla_deadline TEXT;');
  }
  if (!cols.has('rejection_reason')) {
    db.exec('ALTER TABLE coding_decisions ADD COLUMN rejection_reason TEXT;');
  }
}

function down() {
  console.warn('[084] down: no-op');
}

module.exports = { up, down };
