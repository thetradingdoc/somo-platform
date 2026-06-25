#!/usr/bin/env node
'use strict';

/** AT-P2-003 copay */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const tools = findToolEvents(events, 'collect_insurance');
  const bleed = hasNoClinicalBleed(events);
  printReportAndExit({
    pass: tools.length > 0 && bleed.pass,
    acceptance_test: 'AT-P2-003',
    session_id: session,
    collect_insurance_events: tools.length,
    bleed
  });
}
main();
