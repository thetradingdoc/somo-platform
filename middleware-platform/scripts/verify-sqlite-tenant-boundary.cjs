#!/usr/bin/env node
'use strict';

/**
 * MT-04 — Audit SQLite session tables for cross-tenant customer_id bleed.
 * Fails when a row has customer_id + clinic_id but customer_id is not linked
 * to clinic_id via customer_clinics.
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/verify-sqlite-tenant-boundary.cjs
 *   node scripts/verify-sqlite-tenant-boundary.cjs --json
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const jsonOut = process.argv.includes('--json');

const dbModule = require('../database');
const db = dbModule.db || dbModule;

const SESSION_TABLES = [
  'kelly_rails_session_projection',
  'triage_sessions',
  'session_state_projection',
  'case_records',
  'voice_call_states',
  'voice_conversation_memory',
  'agent_turns',
  'agent_state_snapshots'
];

function tableHasColumns(table, cols) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    const names = new Set(info.map((c) => c.name));
    return cols.every((c) => names.has(c));
  } catch (_) {
    return false;
  }
}

function countCrossTenantBleed(table) {
  if (!tableHasColumns(table, ['customer_id', 'clinic_id'])) {
    return { skipped: true, bleed: 0, samples: [] };
  }
  const rows = db.prepare(`
    SELECT t.customer_id, t.clinic_id, COUNT(*) AS n
    FROM ${table} t
    WHERE t.customer_id IS NOT NULL
      AND TRIM(t.customer_id) != ''
      AND t.clinic_id IS NOT NULL
      AND TRIM(t.clinic_id) != ''
      AND NOT EXISTS (
        SELECT 1 FROM customer_clinics cc
        WHERE cc.customer_id = t.customer_id
          AND cc.clinic_id = t.clinic_id
      )
    GROUP BY t.customer_id, t.clinic_id
    ORDER BY n DESC
    LIMIT 20
  `).all();
  const total = rows.reduce((sum, r) => sum + (r.n || 0), 0);
  return { skipped: false, bleed: total, samples: rows };
}

function main() {
  const report = {
    ok: true,
    tables: {},
    total_bleed: 0
  };

  for (const table of SESSION_TABLES) {
    const result = countCrossTenantBleed(table);
    report.tables[table] = result;
    if (!result.skipped && result.bleed > 0) {
      report.ok = false;
      report.total_bleed += result.bleed;
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('==> verify-sqlite-tenant-boundary (MT-04)');
    for (const [table, result] of Object.entries(report.tables)) {
      if (result.skipped) {
        console.log(`⏭️  ${table} — missing customer_id/clinic_id columns`);
      } else if (result.bleed === 0) {
        console.log(`✅ ${table}: 0 cross-tenant bleed row(s)`);
      } else {
        console.error(`❌ ${table}: ${result.bleed} cross-tenant row(s)`);
        for (const sample of result.samples.slice(0, 3)) {
          console.error(`     customer_id=${sample.customer_id} clinic_id=${sample.clinic_id} n=${sample.n}`);
        }
      }
    }
    if (report.ok) {
      console.log('✅ SQLite tenant boundary audit passed');
    } else {
      console.error(`❌ total cross-tenant bleed: ${report.total_bleed}`);
    }
  }

  if (!report.ok) process.exit(1);
}

main();
