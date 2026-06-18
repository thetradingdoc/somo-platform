#!/usr/bin/env node
'use strict';

/**
 * Spot-check emergency rail — safety gate engaged, no schedule after 911 utterance.
 *
 * Usage:
 *   SESSION_ID=call_xxx DB_PATH=<db> node scripts/verify-emergency-rail-spot.cjs
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  fetchKellyEvents,
  findToolCompleted,
  parsePayload,
  printReportAndExit
} = require('./verify-live-shared.cjs');

const EMERGENCY_UTTERANCE_RE = /\b(911|nine\s*one\s*one|emergency|chest\s+pain|can't\s+breathe|cannot\s+breathe)\b/i;
const SCHEDULE_TOOL_RE = /schedule_appointment/i;

function main() {
  const sessionId = requireSessionId('scripts/verify-emergency-rail-spot.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  let safetyGate = false;
  let emergencyIndex = -1;

  events.forEach((e, idx) => {
    const p = parsePayload(e);
    if (e.event_type === 'orchestration_trace') {
      if (p.gate_matched === 'safety' || p.lane === 'support') {
        safetyGate = true;
      }
    }
    if (e.event_type === 'turn_resolved' && (p.lane === 'support' || p.step === 'handoff')) {
      safetyGate = true;
    }
    const text = String(p.message || p.user_message || p.opener_text || '');
    if (EMERGENCY_UTTERANCE_RE.test(text) && emergencyIndex < 0) {
      emergencyIndex = idx;
    }
  });

  if (!safetyGate) {
    const hasEmergencyReply = events.some((e) => {
      const p = parsePayload(e);
      const reply = String(p.reply || p.assistant_message || p.opener_text || '');
      return /911|emergency/i.test(reply);
    });
    if (hasEmergencyReply) safetyGate = true;
  }

  let scheduleAfterEmergency = false;
  if (emergencyIndex >= 0) {
    const after = events.slice(emergencyIndex + 1);
    scheduleAfterEmergency = findToolCompleted(after, SCHEDULE_TOOL_RE);
  } else {
    scheduleAfterEmergency = findToolCompleted(events, SCHEDULE_TOOL_RE);
  }

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    event_count: events.length,
    safety_gate_detected: safetyGate,
    emergency_utterance_index: emergencyIndex,
    schedule_after_emergency: scheduleAfterEmergency,
    pass: safetyGate && !scheduleAfterEmergency
  });
}

main();
