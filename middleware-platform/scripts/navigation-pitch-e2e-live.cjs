#!/usr/bin/env node
'use strict';

/** AT-P1-005 — pitch E2E live verify */
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

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) {
    console.error('Usage: node scripts/navigation-pitch-e2e-live.cjs --session call_xxx');
    process.exit(2);
  }
  const db = openReadonlyDb();
  const events = fetchKellyEvents(db, session);
  const metro = assertMetroPlan(events);
  const benefits = findToolEvents(events, 'check_plan_benefits').length;
  const findCare = findToolEvents(events, 'find_care_near_me').length;
  const bleed = hasNoClinicalBleed(events);
  const pass = metro.pass && benefits > 0 && findCare > 0 && bleed.pass;

  const report = {
    pass,
    acceptance_test: 'AT-P1-005',
    session_id: session,
    assertions: {
      plan_resolved: metro.pass,
      benefits_tool: benefits > 0,
      find_care_tool: findCare > 0,
      no_clinical_bleed: bleed.pass
    },
    bleed
  };

  if (pass) {
    const fs = require('fs');
    const gatePath = path.join(__dirname, '..', 'var', 'evidence', 'navigation', 'P1_GATE.json');
    fs.mkdirSync(path.dirname(gatePath), { recursive: true });
    fs.writeFileSync(
      gatePath,
      JSON.stringify({ gate: 'P1', passed: true, timestamp: new Date().toISOString(), session_id: session, ...report }, null, 2) + '\n'
    );
  }

  printReportAndExit(report);
}

main();
