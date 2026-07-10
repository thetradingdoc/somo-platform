#!/usr/bin/env node
'use strict';

/**
 * Phase 7.1 — Reconcile Postgres vs GCS SQLite Kelly event counts (CR-066).
 *
 * Usage:
 *   node scripts/verify-postgres-gcs-reconciliation.cjs
 *   GCS_DB_BUCKET=somo-staging-db-somo-callsomo node scripts/verify-postgres-gcs-reconciliation.cjs --pull
 *   POSTGRES_PRIMARY=1 RETELL_API_KEY=... node scripts/verify-postgres-gcs-reconciliation.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { reconcileEventCounts, isPostgresPrimary } = require('./lib/kelly-events-read-source.cjs');
const { pullProdDbFromGcs, resolvePulledProdDbPath } = require('./lib/verify-db.cjs');

async function main() {
  const pull = process.argv.includes('--pull');
  let dbPath = process.env.DB_PATH || null;
  if (pull || !dbPath) {
    try {
      dbPath = pullProdDbFromGcs();
    } catch (e) {
      dbPath = resolvePulledProdDbPath();
    }
  }

  const sinceArg = process.argv.find((a) => a.startsWith('--since-minutes='));
  const sinceMinutes = sinceArg ? parseInt(sinceArg.split('=')[1], 10) : 120;

  const report = await reconcileEventCounts({ dbPath, sinceMinutes });
  console.log(JSON.stringify(report, null, 2));

  if (!report.pass) {
    console.error(
      '\nReconciliation FAILED: verify script would report 0 Kelly events against wrong store.'
    );
    console.error(`Mode: ${isPostgresPrimary() ? 'POSTGRES_PRIMARY' : 'sqlite_gcs'}`);
    console.error('Use Retell API or Postgres voice_call_log when GCS snapshot is empty.');
    process.exit(1);
  }
  console.log('\nverify-postgres-gcs-reconciliation: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
