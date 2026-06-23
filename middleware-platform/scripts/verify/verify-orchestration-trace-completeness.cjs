#!/usr/bin/env node
'use strict';

/**
 * Audit orchestration_trace events for missing gate/lane/step fields.
 *
 * Usage:
 *   DB_PATH=./middleware-prod.db node scripts/verify/verify-orchestration-trace-completeness.cjs
 *   KELLY_TRACE_CHECK_HOURS=24 node scripts/verify/verify-orchestration-trace-completeness.cjs
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const { openReadonlyDb, resolveDbPath, parsePayload } = require('./verify-live-shared');

const REQUIRED = ['gate_matched', 'gate_outcome', 'lane', 'step'];
const windowHours = parseInt(process.env.KELLY_TRACE_CHECK_HOURS || '24', 10);

function main() {
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);

  const rows = db
    .prepare(
      `SELECT session_id, event_type, payload_json, created_at
       FROM kelly_call_events
       WHERE event_type = 'orchestration_trace'
         AND datetime(created_at) >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 2000`
    )
    .all(`-${windowHours} hours`);

  const incomplete = [];
  for (const row of rows) {
    const p = parsePayload(row);
    const missing = REQUIRED.filter((f) => {
      const val = p[f];
      return val == null || val === '';
    });
    if (missing.length) {
      incomplete.push({
        session_id: row.session_id,
        created_at: row.created_at,
        missing,
        lane: p.lane || null,
        step: p.step || null
      });
    }
  }

  const report = {
    db_path: dbPath,
    window_hours: windowHours,
    trace_event_count: rows.length,
    incomplete_count: incomplete.length,
    incomplete_sample: incomplete.slice(0, 20),
    pass: incomplete.length === 0
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
