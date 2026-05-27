#!/usr/bin/env node
'use strict';

/**
 * Placeholder ops script: log claims awaiting 835 remittance match.
 * Real ERA ingest is via POST /webhooks/stedi/remittance-advice.
 *
 * Usage: node scripts/poll-remittance-advice.cjs [--limit 20]
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function main() {
  const limit = parseInt(getArg('limit', '20'), 10) || 20;
  const sqlite = db.db;
  if (!sqlite) {
    console.error('SQLite required');
    process.exit(1);
  }
  const rows = sqlite.prepare(`
    SELECT id, status, x12_claim_id, submitted_at
    FROM insurance_claims
    WHERE status IN ('approved', 'processing', 'submitted')
      AND (payment_amount IS NULL OR payment_amount = 0)
    ORDER BY submitted_at ASC
    LIMIT ?
  `).all(limit);
  console.log(JSON.stringify({ awaiting_835: rows.length, claims: rows }, null, 2));
}

main();
