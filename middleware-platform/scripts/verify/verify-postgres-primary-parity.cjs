#!/usr/bin/env node
'use strict';

/**
 * Compare SQLite vs Postgres row counts for hot-path tables when POSTGRES_PRIMARY=1.
 *
 * Usage:
 *   POSTGRES_URL=... POSTGRES_PRIMARY=1 DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-postgres-primary-parity.cjs
 *   node scripts/verify/verify-postgres-primary-parity.cjs --check-only
 */

const path = require('path');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check-only');
const tolerancePct = parseFloat(process.env.POSTGRES_PARITY_TOLERANCE_PCT || '5', 10);

const TABLES = [
  'kelly_call_events',
  'usage_events',
  'kelly_rails_session_projection',
];

function sqliteCount(db, table) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    return Number(row?.c || 0);
  } catch (e) {
    if (/no such table/i.test(e.message)) return 0;
    throw e;
  }
}

async function postgresCount(sql, table) {
  const rows = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return Number(rows[0]?.c || 0);
}

async function main() {
  if (checkOnly || !process.env.POSTGRES_URL || String(process.env.POSTGRES_PRIMARY || '') !== '1') {
    console.log(
      JSON.stringify(
        {
          skipped: true,
          reason: checkOnly
            ? 'check-only'
            : 'POSTGRES_URL or POSTGRES_PRIMARY=1 not set',
          tables: TABLES,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const dbPath =
    process.env.DB_PATH ||
    path.join(__dirname, '../../var/db/middleware-dev.db');
  const Database = require('better-sqlite3');
  const sqlite = new Database(dbPath, { readonly: true });
  const { createPool } = require('../../utils/postgres');
  const sql = createPool();

  const results = [];
  let failed = false;

  for (const table of TABLES) {
    const sqliteN = sqliteCount(sqlite, table);
    let pgN = 0;
    let pgError = null;
    try {
      pgN = await postgresCount(sql, table);
    } catch (e) {
      pgError = e.message;
      failed = true;
    }
    const diff = Math.abs(sqliteN - pgN);
    const denom = Math.max(sqliteN, pgN, 1);
    const driftPct = (diff / denom) * 100;
    const ok = !pgError && driftPct <= tolerancePct;
    if (!ok) failed = true;
    results.push({
      table,
      sqlite: sqliteN,
      postgres: pgN,
      drift_pct: Number(driftPct.toFixed(2)),
      ok,
      error: pgError,
    });
  }

  sqlite.close();
  const out = {
    passed: !failed,
    tolerance_pct: tolerancePct,
    results,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
