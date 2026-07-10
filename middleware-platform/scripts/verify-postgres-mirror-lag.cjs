#!/usr/bin/env node
'use strict';

/**
 * Phase 7.2 — Postgres mirror lag + queue depth gate.
 * Mirror is eventual-consistency only (not transactional with SQLite).
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/verify-postgres-mirror-lag.cjs
 *   STRICT=1 node scripts/verify-postgres-mirror-lag.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const Database = require('better-sqlite3');
const {
  POSTGRES_MIRROR_STALENESS_SEC,
  POSTGRES_SYNC_RETRY_ALERT_DEPTH,
  POSTGRES_SYNC_DLQ_ALERT_MIN,
  MIRROR_MODE
} = require('../config/postgres-mirror-policy');

function truthy(v) {
  return ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());
}

function openDb() {
  const dbPath =
    process.env.DB_PATH ||
    path.join(__dirname, '..', 'var/db/middleware-dev.db');
  return new Database(dbPath, { readonly: true });
}

async function measurePostgresLagSample() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) return { available: false, lag_sec: null, note: 'POSTGRES_URL unset — skip live lag probe' };
  try {
    const postgres = require('postgres');
    const sql = postgres(url, { max: 1, connect_timeout: 10 });
    try {
      const rows = await sql`
        SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::float AS lag_sec
        FROM voice_call_log
        WHERE created_at IS NOT NULL
      `;
      const lag = rows[0]?.lag_sec;
      return {
        available: true,
        lag_sec: lag != null && Number.isFinite(lag) ? Math.round(lag) : null,
        bound_sec: POSTGRES_MIRROR_STALENESS_SEC
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (e) {
    return { available: false, lag_sec: null, error: e.message };
  }
}

async function main() {
  const strict = truthy(process.env.STRICT) || truthy(process.env.PHASE7_STRICT);
  const report = {
    mirror_mode: MIRROR_MODE,
    staleness_bound_sec: POSTGRES_MIRROR_STALENESS_SEC,
    pass: true,
    checks: []
  };

  const db = openDb();
  try {
    const retryN = db.prepare('SELECT COUNT(*) AS n FROM postgres_sync_retry').get()?.n ?? 0;
    const dlqN = db.prepare('SELECT COUNT(*) AS n FROM postgres_sync_dlq').get()?.n ?? 0;
    const retryOk = retryN < POSTGRES_SYNC_RETRY_ALERT_DEPTH;
    const dlqOk = dlqN < POSTGRES_SYNC_DLQ_ALERT_MIN;
    report.checks.push({
      name: 'postgres_sync_retry_depth',
      ok: retryOk,
      value: retryN,
      threshold: POSTGRES_SYNC_RETRY_ALERT_DEPTH
    });
    report.checks.push({
      name: 'postgres_sync_dlq_empty',
      ok: dlqOk,
      value: dlqN,
      threshold: POSTGRES_SYNC_DLQ_ALERT_MIN
    });
    if (!retryOk || !dlqOk) report.pass = false;
  } catch (e) {
    report.checks.push({ name: 'sqlite_queue_tables', ok: false, error: e.message });
    if (strict) report.pass = false;
  } finally {
    db.close();
  }

  const lag = await measurePostgresLagSample();
  report.postgres_lag = lag;
  if (lag.available && lag.lag_sec != null && lag.lag_sec > POSTGRES_MIRROR_STALENESS_SEC) {
    report.checks.push({
      name: 'postgres_mirror_lag_within_bound',
      ok: false,
      lag_sec: lag.lag_sec,
      bound_sec: POSTGRES_MIRROR_STALENESS_SEC
    });
    report.pass = false;
  } else if (lag.available && lag.lag_sec != null) {
    report.checks.push({
      name: 'postgres_mirror_lag_within_bound',
      ok: true,
      lag_sec: lag.lag_sec,
      bound_sec: POSTGRES_MIRROR_STALENESS_SEC
    });
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass && strict) {
    console.error('\nverify-postgres-mirror-lag: FAILED (STRICT)');
    process.exit(1);
  }
  if (!report.pass) {
    console.warn('\nverify-postgres-mirror-lag: warnings (informational — set STRICT=1 to fail)');
  } else {
    console.log('\nverify-postgres-mirror-lag: OK');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
