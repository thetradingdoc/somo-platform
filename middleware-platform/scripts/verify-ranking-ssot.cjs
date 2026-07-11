#!/usr/bin/env node
'use strict';

/**
 * CP-05 — Ranking SSOT verification gate.
 * Ensures select-primary-codes is the sole primary ranker (not naive [0]).
 */

const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..');
const BASELINE_PATH = path.join(MP, 'tmp/coding-ranking-baseline.json');

const { selectPrimaryIcd10, selectPrimaryProcedure } = require('../services/select-primary-codes');
const { rankPrimaryCodes } = require('../services/visit-codes-service');

const SCENARIOS = [
  {
    id: 'icd-confidence-order',
    run: () => selectPrimaryIcd10(
      [{ code: 'L70.0', confidence: 0.5 }, { code: 'L30.9', confidence: 0.92 }],
      []
    ),
    expect: 'L30.9'
  },
  {
    id: 'pair-valid-cpt',
    run: () => {
      const pick = selectPrimaryProcedure({
        cptCandidates: [
          { code: '99285', confidence: 0.95 },
          { code: '99213', confidence: 0.7 }
        ],
        hcpcsCandidates: [],
        primaryIcd10: 'Z00.00'
      });
      return pick.code;
    },
    expect: '99213'
  },
  {
    id: 'visit-codes-not-array-zero',
    run: () => {
      const ranked = rankPrimaryCodes({
        icd10: [{ code: 'K21.0', confidence: 0.4 }, { code: 'K29.70', confidence: 0.91 }],
        cpt: [{ code: '99285', confidence: 0.99 }, { code: '99213', confidence: 0.6 }],
        hcpcs: []
      });
      return ranked.primary_icd10;
    },
    expect: 'K29.70'
  }
];

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(results) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  const payload = {
    version: 1,
    frozen_at: new Date().toISOString(),
    ssot_module: 'services/select-primary-codes.js',
    scenarios: results
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2));
  console.log(`✅ Wrote baseline: ${BASELINE_PATH}`);
}

function main() {
  const freeze = process.argv.includes('--freeze');
  const results = [];
  let failed = 0;

  for (const scenario of SCENARIOS) {
    const actual = scenario.run();
    const passed = actual === scenario.expect;
    results.push({ id: scenario.id, expect: scenario.expect, actual, passed });
    console.log(`${passed ? '✅' : '❌'} ${scenario.id}: ${actual} (expect ${scenario.expect})`);
    if (!passed) failed++;
  }

  const visitSrc = fs.readFileSync(path.join(MP, 'services/visit-codes-service.js'), 'utf8');
  if (!visitSrc.includes('select-primary-codes')) {
    console.error('❌ visit-codes-service.js must import select-primary-codes (CP-05 SSOT)');
    failed++;
  } else {
    console.log('✅ visit-codes-service uses select-primary-codes SSOT');
  }

  if (freeze) {
    writeBaseline(results);
    process.exit(failed ? 1 : 0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.warn('⚠️  No baseline at tmp/coding-ranking-baseline.json — run with --freeze after green');
    process.exit(failed ? 1 : 0);
  }

  for (const row of results) {
    const frozen = (baseline.scenarios || []).find((s) => s.id === row.id);
    if (!frozen) {
      console.error(`❌ Missing baseline scenario: ${row.id}`);
      failed++;
      continue;
    }
    if (frozen.expect !== row.actual) {
      console.error(`❌ Baseline drift ${row.id}: was ${frozen.expect}, now ${row.actual}`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n❌ verify-ranking-ssot: ${failed} failure(s)\n`);
    process.exit(1);
  }
  console.log('\n✅ verify-ranking-ssot passed\n');
}

main();
