#!/usr/bin/env node
'use strict';

/** AT-P5-001 conversation quality */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

async function verifyRetell(session) {
  const key = process.env.RETELL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://api.retellai.com/v2/get-call/${session}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!r.ok) return null;
    const c = await r.json();
    const t = String(c.transcript || '');
    return {
      opqrst: /what makes it better|when did this start/i.test(t),
      demo_qual: /qualify your practice|signup for somo/i.test(t),
      multi_topic: /dental|mental|therapy|psychiat/i.test(t) && /metro|plan|zip/i.test(t)
    };
  } catch (_) {
    return null;
  }
}

async function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const navTraces = events.filter((e) => e.event_type === 'orchestration_trace').length;
  const tools = findToolEvents(events, 'resolve_patient_plan').length + findToolEvents(events, 'find_care_near_me').length;
  const bleed = hasNoClinicalBleed(events);
  const retell = await verifyRetell(session);
  let pass = navTraces > 0 && tools > 0 && bleed.pass;
  if (retell?.opqrst || retell?.demo_qual) pass = false;

  printReportAndExit({
    pass,
    acceptance_test: 'AT-P5-001',
    session_id: session,
    navigation_traces: navTraces,
    tool_activity: tools,
    retell,
    bleed
  });
}
main();
