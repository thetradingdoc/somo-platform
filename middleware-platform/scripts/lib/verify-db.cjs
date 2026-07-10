'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { canonicalDbPath } = require('./verify-env.cjs');
const { parseJson } = require('./verify-assert.cjs');

function resolveDbPath(dbPath) {
  return dbPath || canonicalDbPath();
}

function openReadonlyDb(dbPath) {
  const p = resolveDbPath(dbPath);
  if (!fs.existsSync(p)) {
    console.error(`DB not found: ${p}`);
    process.exit(2);
  }
  return new Database(p, { readonly: true });
}

function openAppDb() {
  const dbMod = require('../../database');
  return { dbMod, db: dbMod.db };
}

function fetchKellyEventsRaw(db, sessionId) {
  return db
    .prepare(
      `SELECT event_type, payload_json, created_at, clinic_id
       FROM kelly_call_events
       WHERE session_id = ? OR call_id = ?
       ORDER BY created_at ASC`
    )
    .all(sessionId, sessionId);
}

function fetchKellyEventsUnified(dbOrMod, sessionId) {
  if (dbOrMod?.listKellyCallEvents) {
    return dbOrMod.listKellyCallEvents({ session_id: sessionId, limit: 200 }) || [];
  }
  return fetchKellyEventsRaw(dbOrMod, sessionId);
}

/** Async wrapper — uses Retell fallback when sqlite has 0 rows (POSTGRES_PRIMARY / GCS lag). */
async function fetchKellyEventsUnifiedAsync(dbOrMod, sessionId) {
  const events = fetchKellyEventsUnified(dbOrMod, sessionId);
  if (events.length > 0) return { events, source: 'sqlite' };
  const { fetchKellyEventsWithFallback } = require('./kelly-events-read-source.cjs');
  const db = dbOrMod?.listKellyCallEvents ? null : dbOrMod;
  if (!db) return { events: [], source: 'none' };
  return fetchKellyEventsWithFallback(db, sessionId);
}

function findToolCompleted(events, toolNamePattern) {
  const re =
    toolNamePattern instanceof RegExp
      ? toolNamePattern
      : new RegExp(String(toolNamePattern || ''), 'i');
  return events.some((e) => {
    if (e.event_type !== 'tool_completed') return false;
    const p = parseJson(e.payload_json);
    const name = String(p.tool_name || p.tool || '');
    return re.test(name);
  });
}

function findEventType(events, eventType) {
  return events.some((e) => e.event_type === eventType);
}

/** GCS pull target — never var/db/middleware-dev.db (bootstrap default). */
function resolvePulledProdDbPath() {
  const mpRoot = path.join(__dirname, '..', '..');
  const repoRoot = path.join(mpRoot, '..');
  return path.resolve(
    process.env.PHASE1_DB_PATH ||
      process.env.NAVIGATION_GCS_DB_PATH ||
      path.join(repoRoot, 'backups', 'middleware-staging.db')
  );
}

function assertDbIntegrity(dbPath) {
  const p = path.resolve(dbPath);
  if (!fs.existsSync(p)) {
    throw new Error(`DB not found: ${p}`);
  }
  const sqlite = new Database(p, { readonly: true });
  try {
    const row = sqlite.pragma('integrity_check', { simple: true });
    if (row !== 'ok') {
      throw new Error(`SQLite integrity_check failed on ${p}: ${row}`);
    }
  } finally {
    sqlite.close();
  }
}

function pullProdDbFromGcs() {
  const { execSync } = require('child_process');
  const bucket = process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo';
  const object = process.env.GCS_DB_OBJECT || 'middleware-staging.db';
  const dest = resolvePulledProdDbPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      fs.unlinkSync(dest + suffix);
    } catch (_) {}
  }
  const gsPath = `gs://${bucket}/${object}`;
  console.log(`Pulling ${gsPath} → ${dest}`);
  execSync(`gsutil cp "${gsPath}" "${dest}"`, { stdio: 'inherit' });
  assertDbIntegrity(dest);
  process.env.DB_PATH = dest;
  return dest;
}

module.exports = {
  resolveDbPath,
  resolvePulledProdDbPath,
  assertDbIntegrity,
  pullProdDbFromGcs,
  openReadonlyDb,
  openAppDb,
  fetchKellyEventsRaw,
  fetchKellyEventsUnified,
  fetchKellyEventsUnifiedAsync,
  findToolCompleted,
  findEventType
};
