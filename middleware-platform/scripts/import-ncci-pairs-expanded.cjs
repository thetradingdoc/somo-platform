#!/usr/bin/env node
'use strict';

/**
 * Import expanded NCCI PTP subset into pair_rules (BL-01).
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/import-ncci-pairs-expanded.cjs
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const db = require('../database');
const { buildNcciPairRows, NCCI_SAMPLE_PAIRS } = require('./lib/ncci-pairs-sample.cjs');

function main() {
  const mig = require('../migrations/109_pair_rules');
  mig.up(db.db || db);

  const rows = buildNcciPairRows(NCCI_SAMPLE_PAIRS);
  if (rows.length === 0) {
    console.error('❌ No NCCI pairs to import.');
    process.exit(1);
  }

  const result = db.bulkUpsertPairRules(rows);
  const total = db.getPairRulesCount?.() ?? result.inserted;

  console.log(JSON.stringify({
    imported: result.inserted,
    total,
    sample_pairs: NCCI_SAMPLE_PAIRS.length,
    expanded_beyond_32: total > 32
  }, null, 2));

  if (total <= 32) {
    console.error('❌ pair_rules count must exceed 32 (BL-01 acceptance).');
    process.exit(1);
  }

  console.log(`✅ NCCI pair_rules import complete: ${total} rules`);
}

main();
