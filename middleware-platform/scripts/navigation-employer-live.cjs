#!/usr/bin/env node
'use strict';

/** AT-P4-001 employer member call */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, findNavigationEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const employer = findToolEvents(events, 'resolve_employer_member');
  const resolved = findNavigationEvents(events, 'employer_member_resolved');
  const bleed = hasNoClinicalBleed(events);
  const pass = (employer.length > 0 || resolved.length > 0) && bleed.pass;
  const report = { pass, acceptance_test: 'AT-P4-001', session_id: session, employer_tool: employer.length, bleed };
  if (pass) {
    const gatePath = path.join(__dirname, '..', 'var', 'evidence', 'navigation', 'P4_GATE.json');
    fs.mkdirSync(path.dirname(gatePath), { recursive: true });
    fs.writeFileSync(gatePath, JSON.stringify({ gate: 'P4', passed: true, timestamp: new Date().toISOString(), ...report }, null, 2) + '\n');
  }
  printReportAndExit(report);
}
main();
