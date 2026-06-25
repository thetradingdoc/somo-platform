#!/usr/bin/env node
'use strict';

/** AT-P1-002 — resolve_patient_plan live verify */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const {
  fetchKellyEvents,
  findToolEvents,
  assertMetroPlan,
  hasNoClinicalBleed
} = require('./lib/navigation-live-shared.cjs');
const { METRO_ENTITY_ID } = require('./lib/navigation-demo-config.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) {
    console.error('Usage: node scripts/navigation-resolve-plan-live.cjs --session call_xxx');
    process.exit(2);
  }
  const db = openReadonlyDb();
  const events = fetchKellyEvents(db, session);
  const tools = findToolEvents(events, 'resolve_patient_plan');
  const metro = assertMetroPlan(events);
  const bleed = hasNoClinicalBleed(events);
  const pass = tools.length > 0 && metro.pass && bleed.pass;

  printReportAndExit({
    pass,
    acceptance_test: 'AT-P1-002',
    session_id: session,
    resolve_patient_plan_events: tools.length,
    payor_entity_id: metro.payload?.payor_entity_id || null,
    expected: METRO_ENTITY_ID,
    assertions: { tool_fired: tools.length > 0, metro_entity: metro.pass, no_clinical_bleed: bleed.pass },
    bleed
  });
}

main();
