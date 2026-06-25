#!/usr/bin/env node
'use strict';

/** AT-P1-004 — find_care_near_me live verify */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { openReadonlyDb, printReportAndExit, parseArgs, parsePayload } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');
const { EXPECTED_SPECIALTIES } = require('./lib/navigation-demo-config.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) {
    console.error('Usage: node scripts/navigation-find-care-live.cjs --session call_xxx');
    process.exit(2);
  }
  const db = openReadonlyDb();
  const events = fetchKellyEvents(db, session);
  const tools = findToolEvents(events, 'find_care_near_me');
  const specialties = new Set();
  for (const e of tools) {
    const p = parsePayload(e);
    const r = p.result || {};
    if (r.specialty) specialties.add(r.specialty);
    if (p.specialty) specialties.add(p.specialty);
  }
  const bleed = hasNoClinicalBleed(events);
  const pass = tools.length > 0 && specialties.size >= 1 && bleed.pass;

  printReportAndExit({
    pass,
    acceptance_test: 'AT-P1-004',
    session_id: session,
    find_care_events: tools.length,
    specialties_seen: [...specialties],
    expected_specialties: EXPECTED_SPECIALTIES,
    assertions: { tool_fired: tools.length > 0, has_providers: specialties.size >= 1, no_clinical_bleed: bleed.pass },
    bleed
  });
}

main();
