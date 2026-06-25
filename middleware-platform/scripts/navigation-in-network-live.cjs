#!/usr/bin/env node
'use strict';

/** AT-P3-001 in-network find */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs, parsePayload } = require('./verify-live-shared.cjs');
const { fetchKellyEvents, findToolEvents, hasNoClinicalBleed } = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) process.exit(2);
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const tools = findToolEvents(events, 'find_care_near_me');
  let inNetworkOnly = false;
  for (const e of tools) {
    const p = parsePayload(e);
    if (p.args?.in_network_only || p.in_network_only) inNetworkOnly = true;
  }
  const bleed = hasNoClinicalBleed(events);
  printReportAndExit({
    pass: tools.length > 0 && bleed.pass,
    acceptance_test: 'AT-P3-001',
    session_id: session,
    find_events: tools.length,
    in_network_only_seen: inNetworkOnly,
    bleed
  });
}
main();
