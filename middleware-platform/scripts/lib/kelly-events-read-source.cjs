'use strict';

/**
 * Unified Kelly call-event read path (Phase 7.1 — CR-066).
 *
 * When POSTGRES_PRIMARY=1, GCS SQLite snapshots may lack recent kelly_call_events.
 * Verify scripts must not treat an empty GCS pull as "zero calls" when Retell/Postgres
 * has evidence. Read order:
 *   1. Local SQLite (DB_PATH or pulled GCS)
 *   2. Retell list-calls API (when RETELL_API_KEY set and sqlite count is 0)
 *   3. Postgres voice_call_log row count (proxy when POSTGRES_PRIMARY=1)
 */

const fs = require('fs');
const { fetchKellyEventsRaw, openReadonlyDb } = require('./verify-db.cjs');
const { listCalls } = require('./verify-retell.cjs');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function isPostgresPrimary() {
  return truthy(process.env.POSTGRES_PRIMARY);
}

function readSourceLabel() {
  if (isPostgresPrimary()) return 'postgres_primary';
  return 'sqlite_gcs';
}

async function countPostgresVoiceCalls({ sinceMinutes = 60 } = {}) {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) return { available: false, count: 0, error: 'POSTGRES_URL unset' };
  try {
    const postgres = require('postgres');
    const sql = postgres(url, { max: 1, connect_timeout: 10 });
    try {
      const rows = await sql`
        SELECT COUNT(*)::int AS n
        FROM voice_call_log
        WHERE created_at >= NOW() - (${sinceMinutes}::text || ' minutes')::interval
      `;
      return { available: true, count: rows[0]?.n ?? 0, source: 'postgres_voice_call_log' };
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (e) {
    return { available: false, count: 0, error: e.message };
  }
}

function countSqliteKellyEvents(db, { sinceMinutes = 60 } = {}) {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM kelly_call_events WHERE created_at >= ?`
      )
      .get(since);
    return row?.n ?? 0;
  } catch (_) {
    return 0;
  }
}

async function countRetellCalls({ toNumber, sinceMinutes = 60 } = {}) {
  if (!process.env.RETELL_API_KEY) {
    return { available: false, count: 0, error: 'RETELL_API_KEY unset' };
  }
  try {
    const filter = {};
    if (toNumber) filter.to_number = [toNumber];
    const calls = await listCalls(filter, 50);
    const cutoff = Date.now() - sinceMinutes * 60 * 1000;
    const recent = calls.filter((c) => {
      const t = c.start_timestamp || c.end_timestamp || 0;
      return t >= cutoff;
    });
    return { available: true, count: recent.length, source: 'retell_api', call_ids: recent.map((c) => c.call_id) };
  } catch (e) {
    return { available: false, count: 0, error: e.message };
  }
}

/**
 * Fetch kelly_call_events for a session, with Retell metadata fallback when sqlite is empty.
 */
async function fetchKellyEventsWithFallback(db, sessionId, opts = {}) {
  const sqliteEvents = fetchKellyEventsRaw(db, sessionId);
  if (sqliteEvents.length > 0) {
    return { events: sqliteEvents, source: 'sqlite', fallback: null };
  }

  if (process.env.RETELL_API_KEY && sessionId) {
    try {
      const { getCall } = require('./verify-retell.cjs');
      const call = await getCall(sessionId);
      if (call?.call_id) {
        return {
          events: [],
          source: 'retell_only',
          fallback: { call_id: call.call_id, transcript: call.transcript, to_number: call.to_number }
        };
      }
    } catch (_) {}
  }

  return { events: [], source: 'none', fallback: null };
}

/**
 * Reconcile event counts across stores for a time window.
 */
async function reconcileEventCounts(opts = {}) {
  const sinceMinutes = opts.sinceMinutes ?? 60;
  const toNumber = opts.toNumber || process.env.CAPSTONE_TENANT_DID || null;
  const report = {
    read_mode: readSourceLabel(),
    postgres_primary: isPostgresPrimary(),
    since_minutes: sinceMinutes,
    counts: {}
  };

  if (opts.dbPath && fs.existsSync(opts.dbPath)) {
    const db = openReadonlyDb(opts.dbPath);
    try {
      report.counts.sqlite_kelly_events = countSqliteKellyEvents(db, { sinceMinutes });
    } finally {
      db.close();
    }
  } else {
    report.counts.sqlite_kelly_events = null;
  }

  report.counts.retell = await countRetellCalls({ toNumber, sinceMinutes });
  if (isPostgresPrimary()) {
    report.counts.postgres_voice_call_log = await countPostgresVoiceCalls({ sinceMinutes });
  }

  const sqliteN = report.counts.sqlite_kelly_events ?? 0;
  const retellN = report.counts.retell?.count ?? 0;
  const pgN = report.counts.postgres_voice_call_log?.count ?? 0;

  if (isPostgresPrimary()) {
    report.authoritative_source = 'postgres_voice_call_log + retell_api';
    report.pass =
      (sqliteN === 0 && (retellN > 0 || pgN > 0)) ||
      (sqliteN > 0 && retellN <= sqliteN + 5);
    report.note =
      'POSTGRES_PRIMARY=1: empty GCS kelly_call_events is expected; use Retell or Postgres voice_call_log.';
  } else {
    report.authoritative_source = 'sqlite_gcs';
    report.pass = sqliteN > 0 || retellN === 0;
    report.note = 'SQLite/GCS is authoritative; Retell is cross-check only.';
  }

  return report;
}

module.exports = {
  isPostgresPrimary,
  readSourceLabel,
  countSqliteKellyEvents,
  countRetellCalls,
  countPostgresVoiceCalls,
  fetchKellyEventsWithFallback,
  reconcileEventCounts
};
