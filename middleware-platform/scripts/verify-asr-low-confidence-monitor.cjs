#!/usr/bin/env node
'use strict';

/**
 * Monitor low-ASR-confidence clarify events in recent kelly_call_events.
 *
 * Counts language_mismatch events where mismatch_type matches asr_low_confidence*
 * and action_taken=clarify.
 *
 * Usage:
 *   DB_PATH=./middleware-prod.db ASR_MONITOR_HOURS=24 ASR_CLARIFY_MAX=50 node scripts/verify-asr-low-confidence-monitor.cjs
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const { openReadonlyDb, resolveDbPath, parsePayload } = require('./verify-live-shared.cjs');

const windowHours = parseInt(process.env.ASR_MONITOR_HOURS || '24', 10);
const maxClarify = parseInt(process.env.ASR_CLARIFY_MAX || '100', 10);

function main() {
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);

  const rows = db
    .prepare(
      `SELECT session_id, event_type, payload_json, created_at
       FROM kelly_call_events
       WHERE event_type = 'language_mismatch'
         AND datetime(created_at) >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 5000`
    )
    .all(`-${windowHours} hours`);

  const clarifyEvents = [];
  for (const row of rows) {
    const p = parsePayload(row);
    const mismatchType = String(p.mismatch_type || '');
    const action = String(p.action_taken || '');
    if (/asr_low_confidence/i.test(mismatchType) && action === 'clarify') {
      clarifyEvents.push({
        session_id: row.session_id,
        created_at: row.created_at,
        asr_confidence: p.asr_confidence ?? null,
        mismatch_type: mismatchType
      });
    }
  }

  const count = clarifyEvents.length;
  const pass = count <= maxClarify;

  const report = {
    db_path: dbPath,
    window_hours: windowHours,
    clarify_count: count,
    max_allowed: maxClarify,
    sample: clarifyEvents.slice(0, 15),
    pass
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
