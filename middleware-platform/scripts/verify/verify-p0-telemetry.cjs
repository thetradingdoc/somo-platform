#!/usr/bin/env node
'use strict';

/**
 * P0 telemetry self-check — verifies required event types are queryable.
 * Usage: node scripts/verify/verify-p0-telemetry.cjs [sessionId]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../../database');
const sessionId = process.argv[2] || null;

const P0_EVENTS = [
  'identity_invalid',
  'mode_violation_blocked',
  'scope_guardrail_triggered',
  'turn_resolved',
  'handoff_recovery',
  'handoff_exhausted',
  'booking_outcome'
];

function listEvents(sid) {
  if (!db.listKellyCallEvents) return [];
  return db.listKellyCallEvents({ session_id: sid, limit: 500 }) || [];
}

function countByType(events, type) {
  return events.filter((e) => e.event_type === type).length;
}

function main() {
  const events = sessionId ? listEvents(sessionId) : [];
  const globalSample = sessionId ? events : db.listKellyCallEvents?.({ limit: 200 }) || [];

  console.log('P0 telemetry checklist:');
  let allOk = true;
  for (const type of P0_EVENTS) {
    const n = countByType(globalSample, type);
    const ok = sessionId ? n > 0 : true;
    if (sessionId && n === 0) allOk = false;
    console.log(`  ${ok ? '✓' : '○'} ${type}${sessionId ? ` (${n})` : ''}`);
  }

  if (sessionId) {
    const turns = events.filter((e) => e.event_type === 'turn_resolved');
    const withTools = turns.filter((e) => {
      let p = e.payload_json;
      if (typeof p === 'string') {
        try {
          p = JSON.parse(p);
        } catch (_) {
          p = {};
        }
      }
      return Array.isArray(p?.tools_used) && p.tools_used.length > 0;
    });
    console.log(`\nturn_resolved: ${turns.length}, with tools_used: ${withTools.length}`);
    if (!turns.length) allOk = false;
  } else {
    console.log('\nPass a sessionId to verify a specific call path.');
  }

  process.exit(allOk ? 0 : 1);
}

main();
