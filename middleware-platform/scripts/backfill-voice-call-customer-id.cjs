#!/usr/bin/env node
/**
 * Backfill customer_id on voice state tables from voice_call_log (last 30 days).
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const DRY = process.argv.includes('--dry-run');

const TABLES = [
  'voice_call_states',
  'voice_conversation_memory',
  'agent_turns',
  'agent_state_snapshots'
];

function hasColumn(table, col) {
  return db.db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

function main() {
  for (const table of TABLES) {
    if (!hasColumn(table, 'customer_id')) {
      console.warn(`Skip ${table}: no customer_id column (run migration 053)`);
      continue;
    }
    const sql = `
      UPDATE ${table}
      SET customer_id = (
        SELECT v.customer_id FROM voice_call_log v
        WHERE v.call_id = ${table}.call_id AND v.customer_id IS NOT NULL
        ORDER BY v.created_at DESC LIMIT 1
      )
      WHERE (customer_id IS NULL OR customer_id = '')
        AND call_id IN (
          SELECT call_id FROM voice_call_log
          WHERE created_at > datetime('now', '-30 days') AND customer_id IS NOT NULL
        )
    `;
    if (DRY) {
      const would = db.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table} t
           WHERE (t.customer_id IS NULL OR t.customer_id = '')
             AND EXISTS (
               SELECT 1 FROM voice_call_log v
               WHERE v.call_id = t.call_id AND v.customer_id IS NOT NULL
                 AND v.created_at > datetime('now', '-30 days')
             )`
        )
        .get().n;
      console.log(`[dry-run] ${table}: would update ${would} rows`);
    } else {
      const r = db.db.prepare(sql).run();
      console.log(`${table}: updated ${r.changes} rows`);
    }
  }
}

main();
