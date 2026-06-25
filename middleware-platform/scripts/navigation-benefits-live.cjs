#!/usr/bin/env node
'use strict';

/** AT-P1-003 — check_plan_benefits live verify */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { openReadonlyDb, printReportAndExit, parseArgs } = require('./verify-live-shared.cjs');
const {
  fetchKellyEvents,
  findToolEvents,
  findNavigationEvents,
  hasNoClinicalBleed
} = require('./lib/navigation-live-shared.cjs');

function main() {
  const { session } = parseArgs(process.argv);
  if (!session) {
    console.error('Usage: node scripts/navigation-benefits-live.cjs --session call_xxx');
    process.exit(2);
  }
  const db = openReadonlyDb();
  const events = fetchKellyEvents(db, session);
  const tools = findToolEvents(events, 'check_plan_benefits');
  const nav = findNavigationEvents(events, 'benefits_returned');
  const bleed = hasNoClinicalBleed(events);
  const benefitCount = nav.map((e) => {
    try {
      return JSON.parse(e.payload_json).benefit_count || 0;
    } catch (_) {
      return 0;
    }
  });
  const pass = tools.length > 0 && benefitCount.some((c) => c >= 4) && bleed.pass;

  printReportAndExit({
    pass,
    acceptance_test: 'AT-P1-003',
    session_id: session,
    check_plan_benefits_events: tools.length,
    benefits_returned_events: nav.length,
    benefit_counts: benefitCount,
    assertions: { tool_fired: tools.length > 0, four_benefits: benefitCount.some((c) => c >= 4), no_clinical_bleed: bleed.pass },
    bleed
  });
}

main();
