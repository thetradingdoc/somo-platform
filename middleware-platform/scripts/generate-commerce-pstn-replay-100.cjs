#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '../tests/fixtures');
const OUT_JSON = path.join(FIXTURE_DIR, 'commerce-pstn-replay-100.json');
const OUT_COVERAGE = path.join(FIXTURE_DIR, 'commerce-pstn-function-coverage.json');

const { ALL_SCENARIOS } = require('./lib/pstn-replay/somo-pstn-scenarios');

function buildCoverage(calls) {
  const coverage = {};
  for (const call of calls) {
    for (const fn of call.functions_tested) {
      if (!coverage[fn]) coverage[fn] = [];
      if (!coverage[fn].includes(call.id)) coverage[fn].push(call.id);
    }
  }
  for (const ids of Object.values(coverage)) ids.sort();
  return coverage;
}

function main() {
  const calls = [...ALL_SCENARIOS].sort((a, b) => a.id.localeCompare(b.id));

  if (calls.length !== 100) {
    console.error(`Expected 100 calls, got ${calls.length}`);
    process.exit(1);
  }

  const voice = calls.filter((c) => c.channel === 'voice').length;
  const chat = calls.filter((c) => c.channel === 'chat').length;

  const pack = {
    version: '3.0.0',
    generated_at: new Date().toISOString(),
    description:
      'PSTN Replay 100 v3 — golden call transcripts (81 voice + 19 chat). SSOT: scripts/lib/pstn-replay/somo-pstn-scenarios.js',
    merchant_id: 'merchant_c3d547a10f43eeec',
    stats: { total: calls.length, voice, chat },
    calls
  };

  const coverage = buildCoverage(calls);
  const coverageDoc = {
    version: '3.0.0',
    generated_at: pack.generated_at,
    description: 'Function → PSTN call IDs for commerce-pstn-replay-100.json (v3)',
    coverage
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(pack, null, 2) + '\n');
  fs.writeFileSync(OUT_COVERAGE, JSON.stringify(coverageDoc, null, 2) + '\n');

  console.log(`Wrote ${OUT_JSON} (${calls.length} calls: ${voice} voice, ${chat} chat)`);
  console.log(`Wrote ${OUT_COVERAGE} (${Object.keys(coverage).length} functions)`);
}

main();
