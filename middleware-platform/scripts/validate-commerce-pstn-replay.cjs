#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  FIXTURE,
  validatePack,
  writeValidationReport,
  printValidateOnly,
  printSuccessSummary,
  fail
} = require('./lib/commerce-pstn-replay/validate-pack.cjs');

function main() {
  const writeReport = process.argv.includes('--report') || process.env.PSTN_WRITE_REPORT === '1';

  if (!fs.existsSync(FIXTURE)) {
    fail([`Missing fixture: ${FIXTURE}. Run generate-commerce-pstn-replay-100.cjs first.`]);
  }

  const pack = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const result = validatePack(pack);

  if (!result.ok) fail(result.errors);

  const reportPath = writeReport ? writeValidationReport(result) : null;

  if (writeReport) {
    printSuccessSummary(reportPath);
  } else {
    printValidateOnly(result);
  }

  process.exit(0);
}

main();
