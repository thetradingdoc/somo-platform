#!/usr/bin/env node
'use strict';

/** AT-P2-005 book + pay gate */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, findNavigationEvents, assertMetroPlan, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const metro = assertMetroPlan(events);
  const findCare = findToolEvents(events, 'find_care_near_me').length;
  const slots = findToolEvents(events, 'get_available_slots').length;
  const book = findToolEvents(events, 'schedule_appointment').length;
  const copay = findToolEvents(events, 'collect_insurance').length;
  const checkout = findToolEvents(events, 'create_appointment_checkout').length;
  const bleed = hasNoClinicalBleed(events);
  const pass = metro.pass && findCare > 0 && book > 0 && bleed.pass && (copay > 0 || checkout > 0);

  const report = {
    pass,
    acceptance_test: 'AT-P2-005',
    session_id: session,
    find_care: findCare,
    slots,
    book,
    copay,
    checkout,
    bleed
  };
  if (pass) {
    const gatePath = path.join(__dirname, '..', 'var', 'evidence', 'navigation', 'P2_GATE.json');
    fs.mkdirSync(path.dirname(gatePath), { recursive: true });
    fs.writeFileSync(gatePath, JSON.stringify({ gate: 'P2', passed: true, timestamp: new Date().toISOString(), ...report }, null, 2) + '\n');
  }
  printReportAndExit(report);
}
main();
