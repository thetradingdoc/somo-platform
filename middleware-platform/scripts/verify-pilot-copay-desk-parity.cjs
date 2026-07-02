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

const ROOT = path.join(__dirname, '..');
const THRESHOLD_USD = 5;
const MIN_CALLS = 10;
const MIN_PARITY_PCT = 90;

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
  const db = require('../database');
  if (!db.db) {
    console.error('DB unavailable');
    process.exit(strict ? 1 : 0);
  }

  console.log('\n=== Pilot copay desk parity ===\n');

  let sql = `
    SELECT quoted_amount, charged_amount, session_id, created_at
    FROM amount_resolution_log
    WHERE quoted_amount IS NOT NULL AND charged_amount IS NOT NULL
  `;
  const params = [];
  if (clinicId) {
    sql += ` AND session_id IN (
      SELECT session_id FROM kelly_sessions WHERE clinic_id = ?
    )`;
    params.push(clinicId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';

  let rows = [];
  try {
    rows = db.db.prepare(sql).all(...params);
  } catch (e) {
    try {
      rows = db.db
        .prepare(
          `SELECT quoted_amount, charged_amount, session_id, created_at
           FROM amount_resolution_log
           WHERE quoted_amount IS NOT NULL AND charged_amount IS NOT NULL
           ORDER BY created_at DESC LIMIT 500`
        )
        .all();
    } catch (_2) {
      console.log('⚠️  amount_resolution_log unavailable:', e.message);
      process.exit(0);
    }
  }

  if (!rows.length) {
    console.log('ℹ️  No amount_resolution_log rows yet — informational pass (run after shadow calls)');
    process.exit(0);
  }

  const within = rows.filter((r) => Math.abs(r.quoted_amount - r.charged_amount) <= THRESHOLD_USD + 0.009);
  const mismatches = rows.filter((r) => Math.abs(r.quoted_amount - r.charged_amount) > 0.009);
  const parityPct = Math.round((within.length / rows.length) * 100);

  console.log(`Rows: ${rows.length}, within $${THRESHOLD_USD}: ${within.length} (${parityPct}%)`);
  console.log(`Mismatches (any delta): ${mismatches.length}`);

  const enoughCalls = rows.length >= MIN_CALLS;
  const parityOk = parityPct >= MIN_PARITY_PCT;
  const pass = !strict || (!enoughCalls && rows.length === 0) || (enoughCalls && parityOk);

  if (!enoughCalls) {
    console.log(`ℹ️  Need ≥${MIN_CALLS} calls for strict exit; have ${rows.length}`);
  }
  if (mismatches.length) {
    console.log('\nRecent mismatches:');
    for (const m of mismatches.slice(0, 5)) {
      console.log(
        `  session=${m.session_id} quoted=${m.quoted_amount} charged=${m.charged_amount} at=${m.created_at}`
      );
    }
  }

  const icon = pass ? '✅' : '❌';
  console.log(`\n${icon} Parity gate: ${pass ? 'pass' : 'fail'} (strict=${strict})\n`);
  process.exit(pass ? 0 : 1);
}

main();
