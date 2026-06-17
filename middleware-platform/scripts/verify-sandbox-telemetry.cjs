#!/usr/bin/env node
'use strict';

/**
 * Post-sandbox telemetry check — confirms tool_invoked/tool_completed rows exist.
 * Usage:
 *   node scripts/verify-sandbox-telemetry.cjs
 *   node scripts/verify-sandbox-telemetry.cjs --minutes 30 --min-events 5
 */

require('dotenv').config();
const path = require('path');

const minutes = (() => {
  const i = process.argv.indexOf('--minutes');
  return i >= 0 ? Number(process.argv[i + 1]) || 30 : 30;
})();
const minEvents = (() => {
  const i = process.argv.indexOf('--min-events');
  return i >= 0 ? Number(process.argv[i + 1]) || 1 : 1;
})();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
process.env.DB_PATH = dbPath;

const db = require('../database');

function rowsSince(min) {
  if (!db.db) {
    console.error('No SQLite db available');
    process.exit(1);
  }
  return db.db
    .prepare(
      `SELECT event_type,
              json_extract(payload_json, '$.tool_name') AS tool_name,
              json_extract(payload_json, '$.success') AS success,
              session_id,
              created_at
       FROM kelly_call_events
       WHERE event_type IN ('tool_invoked', 'tool_completed')
         AND datetime(created_at) >= datetime('now', ?)
       ORDER BY created_at DESC`
    )
    .all(`-${minutes} minutes`);
}

const rows = rowsSince(minutes);
const completed = rows.filter((r) => r.event_type === 'tool_completed');
const invoked = rows.filter((r) => r.event_type === 'tool_invoked');
const successCount = completed.filter((r) => String(r.success) === '1' || r.success === 1).length;

console.log(`DB: ${dbPath}`);
console.log(`Window: last ${minutes} minutes`);
console.log(`tool_invoked: ${invoked.length}`);
console.log(`tool_completed: ${completed.length} (${successCount} success)`);

if (completed.length < minEvents) {
  console.error(`FAIL: expected at least ${minEvents} tool_completed events, found ${completed.length}`);
  console.error('Run the sandbox first: npm run test:rails:conversation-sandbox');
  process.exit(1);
}

const byTool = {};
for (const r of completed) {
  const t = r.tool_name || '(unknown)';
  byTool[t] = byTool[t] || { ok: 0, fail: 0 };
  if (String(r.success) === '1' || r.success === 1) byTool[t].ok++;
  else byTool[t].fail++;
}

console.log('\nCompleted tools:');
for (const [tool, counts] of Object.entries(byTool).sort()) {
  console.log(`  ${tool}: ${counts.ok} ok, ${counts.fail} fail`);
}

console.log('\nPASS: executor telemetry present');
process.exit(0);
