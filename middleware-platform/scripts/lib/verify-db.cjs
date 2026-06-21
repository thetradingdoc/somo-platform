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

module.exports = {
  resolveDbPath,
  openReadonlyDb,
  openAppDb,
  fetchKellyEventsRaw,
  fetchKellyEventsUnified,
  findToolCompleted,
  findEventType
};
