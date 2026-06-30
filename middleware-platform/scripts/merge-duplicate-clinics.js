#!/usr/bin/env node
'use strict';
/**
 * Merge duplicate clinic rows by normalized name. Re-points FK references to survivor.
 * Usage: node scripts/merge-duplicate-clinics.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
process.chdir(require('path').join(__dirname, '..'));

const db = require('../database');
const dryRun = process.argv.includes('--dry-run');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const clinics = db.db.prepare('SELECT clinic_id, name, slug FROM clinics ORDER BY created_at ASC').all();
const groups = new Map();

for (const c of clinics) {
  const key = normalizeName(c.name);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}

const REPOINT_TABLES = [
  { table: 'voice_call_log', col: 'clinic_id' },
  { table: 'function_call_log', col: 'clinic_id' },
  { table: 'error_log', col: 'clinic_id' },
  { table: 'clinic_phone_numbers', col: 'clinic_id' },
];

function tableHasColumn(table, col) {
  try {
    const cols = db.db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}

function repoint(fromId, toId) {
  for (const { table, col } of REPOINT_TABLES) {
    if (!tableHasColumn(table, col)) continue;
    const n = db.db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(toId, fromId).changes;
    if (n) console.log(`  ${table}: ${n} rows → ${toId}`);
  }
  if (tableHasColumn('customer_clinics', 'clinic_id')) {
    const n = db.db.prepare('UPDATE customer_clinics SET clinic_id = ? WHERE clinic_id = ?').run(toId, fromId).changes;
    if (n) console.log(`  customer_clinics: ${n} rows → ${toId}`);
  }
}

let merged = 0;
for (const [name, list] of groups) {
  if (list.length < 2) continue;
  const survivor = list[0];
  const dupes = list.slice(1);
  console.log(`\nMerge "${survivor.name}": keep ${survivor.clinic_id}, drop ${dupes.length} duplicate(s)`);
  for (const d of dupes) {
    if (dryRun) {
      console.log(`  [dry-run] would merge ${d.clinic_id} → ${survivor.clinic_id}`);
      continue;
    }
    repoint(d.clinic_id, survivor.clinic_id);
    db.db.prepare('DELETE FROM clinics WHERE clinic_id = ?').run(d.clinic_id);
    merged++;
  }
}

console.log(`\nDone. merged=${merged}${dryRun ? ' (dry run)' : ''}`);
