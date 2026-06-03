#!/usr/bin/env node
'use strict';

/**
 * Fail if recent kelly_call_events show hybrid_graph or legacy_process_turn in production DB.
 *
 * Usage:
 *   DB_PATH=./middleware-prod.db node scripts/verify-kelly-rails-prod-runtime-only.cjs
 */

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
const windowHours = parseInt(process.env.KELLY_RUNTIME_CHECK_HOURS || '24', 10);
const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    `SELECT session_id, event_type, payload_json, created_at
     FROM kelly_call_events
     WHERE event_type IN ('turn_resolved', 'runtime_blocked')
       AND datetime(created_at) >= datetime('now', ?)
     ORDER BY created_at DESC
     LIMIT 500`
  )
  .all(`-${windowHours} hours`);

const bad = [];
for (const row of rows) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch (_) {}
  const runtime = payload.runtime || payload.attempted_runtime;
  if (runtime && runtime !== 'kelly_rails_v2') {
    bad.push({ session_id: row.session_id, runtime, created_at: row.created_at, event_type: row.event_type });
  }
}

if (bad.length) {
  console.error(`Found ${bad.length} non-V2 Kelly runtime event(s) in last ${windowHours}h:`);
  console.error(JSON.stringify(bad.slice(0, 10), null, 2));
  process.exit(1);
}

console.log(`OK: no hybrid/legacy Kelly runtime in last ${windowHours}h (${rows.length} events scanned).`);
