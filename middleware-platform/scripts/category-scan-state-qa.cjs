#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    fixture: path.join(__dirname, '..', 'test-fixtures', 'scan-state-barcodes.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--fixture') out.fixture = String(argv[++i] || out.fixture);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const fixture = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
  const states = fixture.samples || [];
  const missing = states.filter((x) => !x.expected_state || !x.barcode);
  if (missing.length) {
    console.error(`[scan-state-qa] invalid fixture rows=${missing.length}`);
    process.exit(1);
  }
  const grouped = states.reduce((acc, row) => {
    const k = row.expected_state;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log('[scan-state-qa] fixture summary');
  console.log(JSON.stringify({ total: states.length, by_state: grouped }, null, 2));
}

main();
