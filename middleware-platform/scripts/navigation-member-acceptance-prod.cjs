#!/usr/bin/env node
'use strict';

/** AT-P5-PROD — member acceptance on production */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const {
  fetchKellyEvents,
  findToolEvents,
  assertMetroPlan,
  hasNoClinicalBleed
} = require('./lib/navigation-live-shared.cjs');

function main() {
  const operator = process.argv.includes('--operator') ? process.argv[process.argv.indexOf('--operator') + 1] : 'operator';
  const { session } = parseArgs(process.argv);
  if (!session) {
    console.error('Usage: node scripts/navigation-member-acceptance-prod.cjs --session call_xxx [--operator name]');
    process.exit(2);
  }
  const events = fetchKellyEvents(openReadonlyDb(), session);
  const metro = assertMetroPlan(events);
  const findCare = findToolEvents(events, 'find_care_near_me').length;
  const benefits = findToolEvents(events, 'check_plan_benefits').length;
  const bleed = hasNoClinicalBleed(events);
  const pass = metro.pass && findCare > 0 && benefits > 0 && bleed.pass;

  const report = {
    pass,
    acceptance_test: 'AT-P5-PROD',
    operator,
    session_id: session,
    assertions: { plan: metro.pass, benefits, find_care: findCare > 0, no_bleed: bleed.pass },
    bleed
  };

  if (pass) {
    const gatePath = path.join(__dirname, '..', 'var', 'evidence', 'navigation', 'P5_PROD_GATE.json');
    fs.mkdirSync(path.dirname(gatePath), { recursive: true });
    fs.writeFileSync(gatePath, JSON.stringify({ gate: 'P5_PROD', passed: true, timestamp: new Date().toISOString(), ...report }, null, 2) + '\n');
  }
  printReportAndExit(report);
}
main();
