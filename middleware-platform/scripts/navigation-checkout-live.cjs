#!/usr/bin/env node
'use strict';

/** AT-P2-004 checkout */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, findNavigationEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const tools = findToolEvents(events, 'create_appointment_checkout');
  const checkout = findNavigationEvents(events, 'checkout_created');
  const bleed = hasNoClinicalBleed(events);
  printReportAndExit({
    pass: (tools.length > 0 || checkout.length > 0) && bleed.pass,
    acceptance_test: 'AT-P2-004',
    session_id: session,
    checkout_tool_events: tools.length,
    checkout_nav_events: checkout.length,
    bleed
  });
}
main();
