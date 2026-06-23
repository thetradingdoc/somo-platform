#!/usr/bin/env node
'use strict';

/**
 * Poll Stedi for submitted claims and update status + code_acceptance_rates.
 *
 * Usage:
 *   node scripts/poll-claim-statuses.cjs [--hours 24] [--limit 50]
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const InsuranceService = require('../services/rcm/insurance-service');

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const hours = parseInt(getArg('hours', '24'), 10) || 24;
  const limit = parseInt(getArg('limit', '50'), 10) || 50;
  const sqlite = db.db;
  if (!sqlite) {
    console.error('SQLite required');
    process.exit(1);
  }

  const rows = sqlite.prepare(`
    SELECT * FROM insurance_claims
    WHERE status IN ('submitted', 'processing')
      AND datetime(submitted_at) < datetime('now', ?)
    ORDER BY submitted_at ASC
    LIMIT ?
  `).all(`-${hours} hours`, limit);

  console.log(`Polling ${rows.length} claim(s) older than ${hours}h...`);
  let updated = 0;
  for (const claim of rows) {
    try {
      const result = await InsuranceService.checkClaimStatus(claim.id);
      if (result?.success) {
        updated++;
        console.log(`  ${claim.id} → ${result.status}`);
      }
    } catch (e) {
      console.warn(`  ${claim.id} failed:`, e.message);
    }
  }
  console.log(JSON.stringify({ polled: rows.length, updated }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
