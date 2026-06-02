#!/usr/bin/env node
'use strict';

/**
 * Verify kelly_call_events shows kelly_rails_v2 runtime after a staging chat turn.
 *
 * Usage:
 *   DB_PATH=./middleware-staging.db node scripts/verify-kelly-rails-runtime-event.cjs
 *   DB_PATH=... node scripts/verify-kelly-rails-runtime-event.cjs --session-id sess-abc
 */

const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
let sessionId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session-id') sessionId = args[++i];
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
const db = new Database(dbPath, { readonly: true });

const sql = sessionId
  ? `SELECT id, session_id, event_type, payload_json, created_at
     FROM kelly_call_events
     WHERE session_id = ? AND event_type = 'turn_resolved'
     ORDER BY created_at DESC LIMIT 10`
  : `SELECT id, session_id, event_type, payload_json, created_at
     FROM kelly_call_events
     WHERE event_type = 'turn_resolved'
     ORDER BY created_at DESC LIMIT 20`;

const rows = sessionId ? db.prepare(sql).all(sessionId) : db.prepare(sql).all();
let found = false;
for (const row of rows) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch (_) {}
  if (payload.runtime === 'kelly_rails_v2') {
    found = true;
    console.log('OK kelly_rails_v2 runtime:', {
      session_id: row.session_id,
      created_at: row.created_at,
      payload
    });
    break;
  }
}

if (!found) {
  console.error('No turn_resolved with runtime=kelly_rails_v2 found.');
  console.error('Send one Kelly chat turn on staging, then re-run with --session-id <id>.');
  process.exit(1);
}
