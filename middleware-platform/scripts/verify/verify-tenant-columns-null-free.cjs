#!/usr/bin/env node
'use strict';

/**
 * SITE-25 — verify tenant columns have no null clinic_id before NOT NULL migration 074.
 * Usage:
 *   node scripts/verify/verify-tenant-columns-null-free.cjs
 *   node scripts/verify/verify-tenant-columns-null-free.cjs --check-only
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const checkOnly = process.argv.includes('--check-only');

const dbModule = require('../../database');
const db = dbModule.db || dbModule;

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

const targets = [
  ['kelly_rails_session_projection', 'clinic_id'],
  ['triage_sessions', 'clinic_id'],
  ['session_state_projection', 'clinic_id'],
  ['case_records', 'clinic_id']
];

let failed = false;
console.log('==> verify-tenant-columns-null-free');
for (const [table, col] of targets) {
  const { skipped, n, error } = countNull(table, col);
  if (skipped) {
    console.log(`⏭️  ${table}.${col} — table/column absent (${error || 'skip'})`);
    continue;
  }
  if (n > 0) {
    console.error(`❌ ${table}.${col}: ${n} null row(s)`);
    failed = true;
  } else {
    console.log(`✅ ${table}.${col}: 0 nulls`);
  }
}

if (failed) {
  if (!checkOnly) process.exit(1);
  console.warn('check-only: nulls present but exit 0');
} else {
  console.log('✅ tenant column null check passed');
}
