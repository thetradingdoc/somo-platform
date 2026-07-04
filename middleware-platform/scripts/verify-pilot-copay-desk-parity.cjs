#!/usr/bin/env node
'use strict';

/**
 * Copay desk parity check for shadow week exit criteria.
 *
 * Usage:
 *   node scripts/verify-pilot-copay-desk-parity.cjs
 *   node scripts/verify-pilot-copay-desk-parity.cjs --clinic-id <id>
 *   STRICT=1 node scripts/verify-pilot-copay-desk-parity.cjs --clinic-id <id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { runPilotDeskParityReport } = require('../e2e/helpers/copay-desk-parity.cjs');

const ROOT = path.join(__dirname, '..');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function main() {
  const strict = truthy(process.env.STRICT);
  const clinicId = process.argv.includes('--clinic-id')
    ? process.argv[process.argv.indexOf('--clinic-id') + 1]
    : process.env.PHASE2_PILOT_CLINIC_ID || null;

  process.chdir(ROOT);

  console.log('\n=== Pilot copay desk parity ===\n');

  const report = runPilotDeskParityReport({ clinicId, strict });

  if (report.reason === 'db_unavailable') {
    console.error('DB unavailable');
    process.exit(strict ? 1 : 0);
  }

  if (report.informational) {
    console.log('ℹ️  No amount_resolution_log rows yet — informational pass (run after shadow calls)');
    process.exit(0);
  }

  console.log(`Rows: ${report.rows}, within $${report.thresholdUsd}: ${report.within} (${report.parityPct}%)`);
  console.log(`Mismatches: ${report.mismatches?.length || 0}`);

  if (!report.enoughCalls) {
    console.log(`ℹ️  Need ≥${report.minCalls} calls for strict exit; have ${report.rows}`);
  }
  if (report.mismatches?.length) {
    console.log('\nRecent mismatches:');
    for (const m of report.mismatches.slice(0, 5)) {
      console.log(
        `  session=${m.session_id} quoted=${m.quoted_amount} charged=${m.charged_amount} at=${m.created_at}`
      );
    }
  }

  const icon = report.ok ? '✅' : '❌';
  console.log(`\n${icon} Parity gate: ${report.ok ? 'pass' : 'fail'} (strict=${strict})\n`);
  process.exit(report.ok ? 0 : 1);
}

main();
