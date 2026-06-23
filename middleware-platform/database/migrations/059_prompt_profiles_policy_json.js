'use strict';

/**
 * CR-026 — policy_json column on prompt_profiles for tenant-policy resolution.
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
  addColumnIfMissing(db, 'prompt_profiles', 'policy_json', 'policy_json TEXT');
  addColumnIfMissing(db, 'prompt_profiles', 'use_case', 'use_case TEXT');
  try {
    db.exec(`
      UPDATE prompt_profiles
      SET policy_json = COALESCE(
        policy_json,
        json_extract(metadata, '$.tenant_policy'),
        '{}'
      )
      WHERE policy_json IS NULL OR policy_json = ''
    `);
    db.exec(`
      UPDATE prompt_profiles
      SET use_case = COALESCE(use_case, json_extract(metadata, '$.use_case'), 'healthcare_clinic')
      WHERE use_case IS NULL OR use_case = ''
    `);
  } catch (_) {}
}

function down(db) {}

module.exports = { up, down };
