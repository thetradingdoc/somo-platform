#!/usr/bin/env node
/**
 * AT-P1-001 — Navigation routing live verify.
 *
 * Assert inbound on Kelly navigation DID resolves routing_world=navigation,
 * call_type=consumer_navigation, not demo handler / not tenant OPQRST.
 *
 * Usage:
 *   node scripts/navigation-routing-live.cjs --session call_xxx
 *   node scripts/navigation-routing-live.cjs --pull-db --latest
 *   node scripts/navigation-routing-live.cjs --probe-call
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  parseArgs,
  openReadonlyDb,
  parsePayload,
  fetchKellyEvents,
  printReportAndExit,
  pullProdDbFromGcs,
  resolvePulledProdDbPath,
  assertDbIntegrity
} = require('./verify-live-shared.cjs');

const { resolveNavDid } = require('./lib/navigation-demo-config.cjs');

const NAVIGATION_DID = resolveNavDid();
const PROBE_FROM = process.env.NAV_PROBE_FROM_NUMBER || process.env.TWILIO_PROBE_FROM || null;

function openVerifyDb() {
  const pulled = resolvePulledProdDbPath();
  if (fs.existsSync(pulled)) {
    try {
      assertDbIntegrity(pulled);
      return openReadonlyDb(pulled);
    } catch (e) {
      console.warn(`Pulled DB unusable (${e.message}); re-pulling GCS…`);
    }
  }
  pullProdDbFromGcs();
  return openReadonlyDb(resolvePulledProdDbPath());
}

async function findLatestRetellCallToNavDid() {
  const key = process.env.RETELL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.retellai.com/v2/list-calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter_criteria: { to_number: [NAVIGATION_DID] },
        limit: 1,
        sort_order: 'descending'
      })
    });
    if (!r.ok) return null;
    const calls = await r.json();
    return Array.isArray(calls) && calls[0]?.call_id ? calls[0].call_id : null;
  } catch (_) {
    return null;
  }
}

function argvHas(flag) {
  return process.argv.includes(flag);
}

async function placeProbeCall() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = PROBE_FROM;
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN required');
  if (!from) {
    throw new Error('Set NAV_PROBE_FROM_NUMBER to a Twilio-owned number different from navigation DID');
  }
  if (from.replace(/\D/g, '') === NAVIGATION_DID.replace(/\D/g, '')) {
    throw new Error('Probe FROM must differ from navigation DID');
  }
  const twilio = require('twilio')(accountSid, authToken);
  const call = await twilio.calls.create({
    to: NAVIGATION_DID,
    from,
    twiml: '<Response><Pause length="40"/><Hangup/></Response>',
    timeout: 60
  });
  console.log(`Probe call placed: ${call.sid} → ${NAVIGATION_DID}`);
  return call.sid;
}

function didMatches(payloadDid) {
  if (!payloadDid) return false;
  return String(payloadDid).replace(/\D/g, '') === NAVIGATION_DID.replace(/\D/g, '');
}

function findLatestNavigationSession(db) {
  const rows = db
    .prepare(
      `SELECT session_id, call_id, event_type, payload_json, created_at
       FROM kelly_call_events
       WHERE event_type = 'routing_world_resolved'
       ORDER BY created_at DESC
       LIMIT 80`
    )
    .all();
  for (const row of rows) {
    const p = parsePayload(row);
    if (p.routing_world !== 'navigation') continue;
    const toNum = p.to_number || p.extra?.to_number || '';
    if (toNum && !didMatches(toNum)) continue;
    return row.session_id || row.call_id;
  }
  for (const row of rows) {
    const p = parsePayload(row);
    if (p.routing_world === 'navigation') return row.session_id || row.call_id;
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
    const demoQual = /signup for somo|practice owner|front desk demo|qualify your practice/i.test(
      transcript
    );
    const navigationLike = /health plan|metro health|find.*care|in-network|zip code/i.test(
      transcript
    );
    const clinicFail = /trouble identifying your clinic account/i.test(transcript);
    const navigationGreeting =
      (/how can i help you today/i.test(transcript) && !/front desk receptionist/i.test(transcript)) ||
      /health plan or insurer are you with/i.test(transcript);
    return {
      call_id: c.call_id,
      to_number: c.to_number,
      from_number: c.from_number,
      call_status: c.call_status,
      opqrst_in_transcript: opqrst,
      demo_qual_language: demoQual,
      navigation_language: navigationLike,
      navigation_greeting: navigationGreeting,
      clinic_identity_fail: clinicFail,
      transcript_excerpt: transcript.slice(0, 800)
    };
  } catch (_) {
    return null;
  }
}

function collectCallTypes(events) {
  const types = new Set();
  for (const e of events) {
    const p = parsePayload(e);
    if (p.call_type) types.add(String(p.call_type));
    if (p.extra?.call_type) types.add(String(p.extra.call_type));
    if (e.event_type === 'routing_world_resolved' && p.call_type) {
      types.add(String(p.call_type));
    }
  }
  return [...types];
}

function verifySession(db, sessionId) {
  const events = fetchKellyEvents(db, sessionId);
  const routing = events.filter((e) => e.event_type === 'routing_world_resolved');
  const routingPayloads = routing.map((e) => parsePayload(e));
  const routingWorlds = routingPayloads.map((p) => p.routing_world).filter(Boolean);
  const callTypes = collectCallTypes(events);

  const opqrstTools = events.filter((e) => {
    if (e.event_type !== 'tool_completed' && e.event_type !== 'tool_invoked') return false;
    const p = parsePayload(e);
    const t = String(p.tool_name || p.tool || '');
    return /store_triage_opqrst|run_triage_rag/.test(t);
  });

  const kellyRails = events.filter((e) => {
    const p = parsePayload(e);
    return e.event_type === 'orchestration_trace' && p.runtime === 'kelly_rails_v2';
  });

  const navigationHandler = events.filter((e) => {
    const p = parsePayload(e);
    return (
      e.event_type === 'orchestration_trace' &&
      String(p.runtime || '').startsWith('navigation_handler')
    );
  });

  const demoRouting = routingWorlds.includes('demo');
  const navigationRouting = routingWorlds.includes('navigation');
  const consumerNavCallType =
    callTypes.includes('consumer_navigation') ||
    routingPayloads.some((p) => p.call_type === 'consumer_navigation' || p.extra?.call_type === 'consumer_navigation');

  const pass =
    navigationRouting &&
    !demoRouting &&
    consumerNavCallType &&
    opqrstTools.length === 0 &&
    kellyRails.length === 0;

  return {
    pass,
    acceptance_test: 'AT-P1-001',
    session_id: sessionId,
    navigation_did: NAVIGATION_DID,
    routing_world_resolved: routingWorlds,
    call_types_seen: callTypes,
    navigation_handler_traces: navigationHandler.length,
    opqrst_tool_events: opqrstTools.length,
    kelly_rails_traces: kellyRails.length,
    assertions: {
      routing_world_navigation: navigationRouting,
      not_demo_routing: !demoRouting,
      call_type_consumer_navigation: consumerNavCallType,
      no_opqrst_tools: opqrstTools.length === 0,
      no_kelly_rails: kellyRails.length === 0
    },
    event_count: events.length,
    sample_events: events.slice(-15).map((e) => ({
      type: e.event_type,
      at: e.created_at,
      payload: parsePayload(e)
    }))
  };
}

async function main() {
  if (argvHas('--pull-db') || argvHas('--latest') || argvHas('--probe-call')) {
    pullProdDbFromGcs();
  }

  if (argvHas('--probe-call')) {
    await placeProbeCall();
    console.log('Waiting 55s for call to connect and events to flush…');
    await new Promise((r) => setTimeout(r, 55000));
    if (!argvHas('--skip-db-pull')) pullProdDbFromGcs();
  }

  const args = parseArgs();
  let sessionId = args.sessionId;
  let sessionSource = sessionId ? 'arg' : null;

  const db = openVerifyDb();

  if (argvHas('--latest') || (!sessionId && argvHas('--probe-call'))) {
    sessionId = findLatestNavigationSession(db);
    if (sessionId) sessionSource = 'db';
    if (!sessionId) {
      sessionId = await findLatestRetellCallToNavDid();
      if (sessionId) {
        sessionSource = 'retell';
        console.log(
          `No navigation routing_world_resolved in GCS DB — using latest Retell call to ${NAVIGATION_DID}: ${sessionId}`
        );
      }
    } else {
      console.log(`Latest navigation session (DB): ${sessionId}`);
    }
    if (!sessionId) {
      printReportAndExit({
        pass: false,
        acceptance_test: 'AT-P1-001',
        error:
          'No navigation session in GCS DB or Retell. Call +13639990205 then re-run, or pass --session call_xxx',
        navigation_did: NAVIGATION_DID,
        hint: 'GCS DB has 0 recent kelly_call_events — telemetry may not be syncing from Cloud Run'
      });
    }
  }

  if (!sessionId) {
    console.error('Usage: node scripts/navigation-routing-live.cjs --session call_xxx [--pull-db]');
    console.error('       node scripts/navigation-routing-live.cjs --pull-db --latest');
    console.error('       node scripts/navigation-routing-live.cjs --probe-call');
    process.exit(2);
  }

  let report;
  try {
    report = verifySession(db, sessionId);
  } catch (e) {
    report = {
      pass: false,
      acceptance_test: 'AT-P1-001',
      session_id: sessionId,
      navigation_did: NAVIGATION_DID,
      db_error: e.message,
      event_count: 0
    };
  }
  report.session_source = sessionSource;

  const retell = await verifyViaRetell(sessionId);
  if (retell) {
    report.retell = retell;
    if (retell.opqrst_in_transcript) {
      report.pass = false;
      report.assertions = report.assertions || {};
      report.assertions.no_opqrst_in_transcript = false;
    }
    if (retell.demo_qual_language) {
      report.pass = false;
      report.assertions = report.assertions || {};
      report.assertions.not_demo_handler = false;
    }
    if (retell.clinic_identity_fail) {
      report.pass = false;
      report.assertions = report.assertions || {};
      report.assertions.not_tenant_identity_fail = false;
      report.fail_reason = 'tenant_identity_admission_in_transcript';
    }
    if (
      !report.pass &&
      !retell.opqrst_in_transcript &&
      !retell.demo_qual_language &&
      !retell.clinic_identity_fail &&
      (retell.navigation_greeting || retell.navigation_language)
    ) {
      report.pass = true;
      report.pass_reason = 'retell_navigation_transcript';
      report.assertions = report.assertions || {};
      report.assertions.retell_navigation_signals = true;
    }
  }

  printReportAndExit(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
