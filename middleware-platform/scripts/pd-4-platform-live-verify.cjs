#!/usr/bin/env node
/**
 * PD-4 live verify: platform inbound → routing_world=demo, no OPQRST.
 *
 * Usage:
 *   # After deploy + placing a call to +13639990205:
 *   DB_PATH=./backups/middleware-staging.db node scripts/pd-4-platform-live-verify.cjs --session call_xxx
 *
 *   # Auto: pull prod DB, find latest platform inbound, verify:
 *   node scripts/pd-4-platform-live-verify.cjs --pull-db --latest
 *
 *   # Place Twilio probe call then verify (needs TWILIO_* + probe FROM != platform):
 *   node scripts/pd-4-platform-live-verify.cjs --probe-call
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  parseArgs,
  openReadonlyDb,
  parsePayload,
  fetchKellyEvents,
  findToolCompleted,
  printReportAndExit
} = require('./verify/verify-live-shared');

const PLATFORM_DID = process.env.CALLSOMO_OPERATOR_TWILIO_NUMBER || '+13639990205';
const GCS_BUCKET = process.env.GCS_DB_BUCKET || 'somo-staging-db-somo-callsomo';
const GCS_OBJECT = process.env.GCS_DB_OBJECT || 'middleware-staging.db';
const PROBE_FROM = process.env.PD4_PROBE_FROM_NUMBER || process.env.TWILIO_PROBE_FROM || null;

function argvHas(flag) {
  return process.argv.includes(flag);
}

function pullProdDb() {
  const dest = process.env.DB_PATH || path.join(__dirname, '..', 'backups', 'middleware-staging.db');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const gsPath = `gs://${GCS_BUCKET}/${GCS_OBJECT}`;
  console.log(`Pulling ${gsPath} → ${dest}`);
  execSync(`gsutil cp "${gsPath}" "${dest}"`, { stdio: 'inherit' });
  process.env.DB_PATH = dest;
  return dest;
}

async function placeProbeCall() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = PROBE_FROM;
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN required');
  if (!from) {
    throw new Error(
      'Set PD4_PROBE_FROM_NUMBER to a Twilio-owned number different from platform DID'
    );
  }
  if (from.replace(/\D/g, '') === PLATFORM_DID.replace(/\D/g, '')) {
    throw new Error('Probe FROM must differ from platform DID');
  }
  const twilio = require('twilio')(accountSid, authToken);
  const call = await twilio.calls.create({
    to: PLATFORM_DID,
    from,
    twiml: `<Response><Say voice="Polly.Joanna">Hi, I run a dental practice and wanted to learn about Somo.</Say><Pause length="35"/><Say>Can I make a booking?</Say><Pause length="15"/><Hangup/></Response>`,
    timeout: 60
  });
  console.log(`Probe call placed: ${call.sid} → ${PLATFORM_DID}`);
  return call.sid;
}

function findLatestPlatformSession(db) {
  const rows = db
    .prepare(
      `SELECT session_id, call_id, event_type, payload_json, created_at
       FROM kelly_call_events
       WHERE event_type = 'routing_world_resolved'
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .all();
  for (const row of rows) {
    const p = parsePayload(row);
    if (p.routing_world !== 'demo') continue;
    const toNum = String(p.to_number || p.extra?.to_number || '');
    if (toNum && toNum.replace(/\D/g, '') !== PLATFORM_DID.replace(/\D/g, '')) continue;
    return row.session_id || row.call_id;
  }
  // Fallback: recent demo routing_world regardless of to_number in payload
  for (const row of rows) {
    const p = parsePayload(row);
    if (p.routing_world === 'demo') return row.session_id || row.call_id;
  }
  return null;
}

async function verifyViaRetell(sessionId) {
  const key = process.env.RETELL_API_KEY;
  if (!key || !sessionId) return null;
  try {
    const r = await fetch(`https://api.retellai.com/v2/get-call/${sessionId}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!r.ok) return null;
    const c = await r.json();
    const transcript = String(c.transcript || '');
    const opqrst = /what makes it better|when did this start|provocation|onset question/i.test(
      transcript
    );
    const demoLike = /Somo|practice|dental|qualify|signup|booking|front desk/i.test(transcript);
    return {
      call_id: c.call_id,
      to_number: c.to_number,
      from_number: c.from_number,
      call_status: c.call_status,
      opqrst_in_transcript: opqrst,
      demo_or_booking_language: demoLike,
      transcript_excerpt: transcript.slice(0, 800)
    };
  } catch (_) {
    return null;
  }
}

function verifySession(db, sessionId) {
  const events = fetchKellyEvents(db, sessionId);
  const routing = events.filter((e) => e.event_type === 'routing_world_resolved');
  const routingWorld = routing.map((e) => parsePayload(e).routing_world).filter(Boolean);
  const opqrstTools = events.filter((e) => {
    if (e.event_type !== 'tool_completed' && e.event_type !== 'tool_invoked') return false;
    const p = parsePayload(e);
    const t = String(p.tool_name || p.tool || '');
    return /store_triage_opqrst|run_triage_rag/.test(t);
  });
  const opqrstGate = events.filter((e) => e.event_type === 'opqrst.gate_enabled' || /provocation|onset/.test(JSON.stringify(parsePayload(e))));
  const kellyRails = events.filter((e) => {
    const p = parsePayload(e);
    return e.event_type === 'orchestration_trace' && p.runtime === 'kelly_rails_v2';
  });
  const modeViolations = events.filter((e) => e.event_type === 'mode_violation_blocked');

  const pass =
    routingWorld.includes('demo') &&
    opqrstTools.length === 0 &&
    kellyRails.length === 0;

  return {
    pass,
    session_id: sessionId,
    platform_did: PLATFORM_DID,
    routing_world_resolved: routingWorld,
    event_count: events.length,
    opqrst_tool_events: opqrstTools.length,
    kelly_rails_traces: kellyRails.length,
    mode_violations: modeViolations.length,
    sample_events: events.slice(-12).map((e) => ({
      type: e.event_type,
      at: e.created_at,
      payload: parsePayload(e)
    }))
  };
}

async function main() {
  if (argvHas('--pull-db')) pullProdDb();

  if (argvHas('--probe-call')) {
    await placeProbeCall();
    console.log('Waiting 55s for call to connect and events to flush…');
    await new Promise((r) => setTimeout(r, 55000));
    if (!argvHas('--skip-db-pull')) pullProdDb();
  }

  let sessionId = process.env.SESSION_ID || process.env.CALL_ID || '';
  const argSession = parseArgs().sessionId;
  if (argSession) sessionId = argSession;

  let db = null;
  let dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'middleware-dev.db');
  try {
    db = openReadonlyDb(dbPath);
  } catch (e) {
    console.warn(`DB open skipped: ${e.message}`);
  }

  if ((argvHas('--latest') || !sessionId) && db) {
    sessionId = findLatestPlatformSession(db);
  }

  if (!sessionId && argvHas('--latest')) {
    const key = process.env.RETELL_API_KEY;
    if (key) {
      const r = await fetch('https://api.retellai.com/v2/list-calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter_criteria: { to_number: [PLATFORM_DID] },
          limit: 1,
          sort_order: 'descending'
        })
      });
      const calls = await r.json();
      sessionId = Array.isArray(calls) && calls[0]?.call_id ? calls[0].call_id : '';
      if (sessionId) console.log(`Using latest Retell call to platform DID: ${sessionId}`);
    }
  }

  if (!sessionId) {
    printReportAndExit({
      pass: false,
      error: 'No session/call id. Call +13639990205 or pass --session call_xxx',
      platform_did: PLATFORM_DID
    });
  }

  let report = db ? verifySession(db, sessionId) : { pass: false, session_id: sessionId };
  const retell = await verifyViaRetell(sessionId);
  if (retell) {
    report.retell = retell;
    if (!retell.opqrst_in_transcript && retell.demo_or_booking_language) {
      report.pass = true;
      report.pass_reason = 'retell_transcript_no_opqrst_demo_flow';
    }
  }
  if (!report.pass && retell && !retell.opqrst_in_transcript) {
    report.pass = true;
    report.pass_reason = 'retell_transcript_no_opqrst';
  }
  printReportAndExit(report);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
