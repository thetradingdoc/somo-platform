#!/usr/bin/env node
'use strict';

/**
 * Phase 1.10 — confirm migrations 074/076 applied and tenant columns are null-free.
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const dbModule = require('../database');
const db = dbModule.db || dbModule;

const REQUIRED = ['074_projection_triage_not_null', '076_tenant_columns_not_null_preflight'];

function countNull(table, col) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === col)) return { skipped: true, n: 0 };
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IS NULL`).get()?.n || 0;
    return { skipped: false, n };
  } catch (e) {
    return { skipped: true, n: 0, error: e.message };
  }
}

let failed = false;
console.log('==> verify-migrations-074-076');

for (const version of REQUIRED) {
  const row = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
  if (row) {
    console.log(`✅ migration ${version} applied`);
  } else {
    console.error(`❌ migration ${version} NOT in schema_migrations — run npm run migrate`);
    failed = true;
  }
}

for (const [table, col] of [
  ['kelly_rails_session_projection', 'clinic_id'],
  ['triage_sessions', 'clinic_id']
]) {
  const { skipped, n, error } = countNull(table, col);
  if (skipped) {
    console.log(`⏭️  ${table}.${col} — skip (${error || 'no column'})`);
    continue;
  }
  if (n > 0) {
    console.error(`❌ ${table}.${col}: ${n} null row(s) — run backfill before NOT NULL promotion`);
    failed = true;
  } else {
    console.log(`✅ ${table}.${col}: 0 nulls`);
  }
}

if (failed) process.exit(1);
console.log('✅ migrations 074/076 verification passed');
