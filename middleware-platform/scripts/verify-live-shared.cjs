#!/usr/bin/env node
'use strict';

/**
 * Shared helpers for production live-call acceptance scripts.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const Database = require('better-sqlite3');

function parseArgs() {
  const argv = process.argv.slice(2);
  let sessionId = process.env.SESSION_ID || process.env.CALL_ID || '';
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--session' || argv[i] === '--call') && argv[i + 1]) {
      sessionId = argv[++i];
    }
  }
  return { sessionId: String(sessionId || '').trim() };
}

function resolveDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
}

function openReadonlyDb(dbPath = resolveDbPath()) {
  if (!fs.existsSync(dbPath)) {
    console.error(`DB not found: ${dbPath}`);
    process.exit(2);
  }
  return new Database(dbPath, { readonly: true });
}

function parsePayload(row) {
  try {
    const raw = row?.payload_json;
    if (raw == null || raw === '') return {};
    if (typeof raw === 'object') return raw;
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function fetchKellyEvents(db, sessionId) {
  return db
    .prepare(
      `SELECT event_type, payload_json, created_at, clinic_id
       FROM kelly_call_events
       WHERE session_id = ? OR call_id = ?
       ORDER BY created_at ASC`
    )
    .all(sessionId, sessionId);
}

function findToolCompleted(events, toolNamePattern) {
  const re =
    toolNamePattern instanceof RegExp
      ? toolNamePattern
      : new RegExp(String(toolNamePattern || ''), 'i');
  return events.some((e) => {
    if (e.event_type !== 'tool_completed') return false;
    const p = parsePayload(e);
    const name = String(p.tool_name || p.tool || '');
    return re.test(name);
  });
}

function findEventType(events, eventType) {
  return events.some((e) => e.event_type === eventType);
}

function requireSessionId(usage) {
  const { sessionId } = parseArgs();
  if (!sessionId) {
    console.error(`Usage: SESSION_ID=<call_id> DB_PATH=<db> node ${usage}`);
    process.exit(2);
  }
  return sessionId;
}

function printReportAndExit(report) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

module.exports = {
  parseArgs,
  resolveDbPath,
  openReadonlyDb,
  parsePayload,
  fetchKellyEvents,
  findToolCompleted,
  findEventType,
  requireSessionId,
  printReportAndExit
};
