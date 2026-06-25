#!/usr/bin/env node
'use strict';

/** AT-P2-002 book */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, findNavigationEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const tools = findToolEvents(events, 'schedule_appointment');
  const booked = findNavigationEvents(events, 'appointment_booked');
  const bleed = hasNoClinicalBleed(events);
  printReportAndExit({
    pass: (tools.length > 0 || booked.length > 0) && bleed.pass,
    acceptance_test: 'AT-P2-002',
    session_id: session,
    schedule_events: tools.length,
    booked_events: booked.length,
    bleed
  });
}
main();
