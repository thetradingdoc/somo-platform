#!/usr/bin/env node
'use strict';

/**
 * C-BR-02: Import manual benefit rows into plan_rules (no Stedi 271).
 * Usage: DB_PATH=./var/db/middleware-dev.db node scripts/import-plan-rules-benefits.cjs path/to/benefits.json
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../database').db;

function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node scripts/import-plan-rules-benefits.cjs <benefits.json>');
    process.exit(2);
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.rows || [];
  let n = 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO plan_rules (
      id, payer_id, plan_id, code_pattern, covered, copay_type, copay_value, requires_pa, effective_date, rule_version
    ) VALUES (?, ?, ?, ?, 1, 'flat', ?, 0, date('now'), 'benefit_ingest')
  `);
  for (const r of list) {
    const code = r.service_code || r.code_pattern;
    if (!r.payer_id || !r.plan_id || !code || r.copay_due_now == null) continue;
    const id = `br_${r.payer_id}_${r.plan_id}_${code}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 120);
    stmt.run(id, r.payer_id, r.plan_id, code, Number(r.copay_due_now));
    n++;
  }
  console.log(JSON.stringify({ ok: true, imported: n, file }, null, 2));
}

main();
