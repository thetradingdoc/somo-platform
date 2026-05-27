#!/usr/bin/env node
'use strict';

/**
 * Poll prior-auth request statuses (stub).
 *
 * Phase 1: Stedi does not support X12 278 submission, so there is no authoritative
 * “check status” endpoint to poll for case-level prior auth decisions.
 *
 * This script exists to establish the operational shape:
 * - select pending requests
 * - call a rail-specific status check (Phase 2)
 * - update prior_auth_requests
 *
 * Usage:
 *   node scripts/poll-prior-auth-statuses.cjs [--hours 24] [--limit 50]
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

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

  // Only pick rows that are pending and old enough to justify polling.
  const rows = sqlite.prepare(`
    SELECT *
    FROM prior_auth_requests
    WHERE status IN ('pending', 'more_info_needed')
      AND datetime(updated_at) < datetime('now', ?)
    ORDER BY datetime(updated_at) ASC
    LIMIT ?
  `).all(`-${hours} hours`, limit);

  console.log(`Polling ${rows.length} prior-auth request(s) older than ${hours}h...`);
  if (!rows.length) return;

  console.log('No-op: status polling requires Phase 2 rail (UHC FHIR write or PA partner).');
  console.log('This script will be activated when submitPriorAuth + checkPriorAuthStatus are implemented.');
}

main().catch((e) => {
  console.error('poll-prior-auth-statuses failed:', e.message);
  process.exit(1);
});

