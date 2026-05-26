#!/usr/bin/env node
'use strict';

/**
 * Audit expected CPT codes in voice-agent-test-cases.json against local codebooks.
 * Classifies: in_cpt | in_hcpcs_only | missing
 *
 * Usage: node scripts/audit-eval-cpt-coverage.cjs
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const db = require('../database');
const sqlite = db.db || db;

const casesPath = path.join(__dirname, '../tests/medical-coding/voice-agent-test-cases.json');
const { cases } = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

const cptSet = new Set(
  sqlite.prepare('SELECT code FROM cpt_codes').all().map((r) => String(r.code).trim())
);
const hcpcsSet = new Set(
  sqlite.prepare('SELECT code FROM hcpcs_codes').all().map((r) => String(r.code).trim().toUpperCase())
);

function classify(code) {
  const c = String(code).trim();
  const cu = c.toUpperCase();
  if (cptSet.has(c)) return 'in_cpt_codes';
  if (hcpcsSet.has(cu)) return 'in_hcpcs_only';
  return 'missing';
}

const byCategory = {};
const allCodes = new Map();

for (const tc of cases) {
  const cat = tc.category || 'unknown';
  if (!byCategory[cat]) byCategory[cat] = { cases: 0, codes: {} };
  byCategory[cat].cases++;
  const expected = tc.expected?.cpt_contains || [];
  for (const code of expected) {
    const status = classify(code);
    if (!byCategory[cat].codes[code]) {
      byCategory[cat].codes[code] = { status, caseIds: [] };
    }
    byCategory[cat].codes[code].caseIds.push(tc.id);
    if (!allCodes.has(code)) allCodes.set(code, status);
  }
}

console.log('\n=== Eval CPT coverage audit ===');
console.log(`cpt_codes rows: ${cptSet.size}`);
console.log(`hcpcs_codes rows: ${hcpcsSet.size}\n`);

for (const [cat, data] of Object.entries(byCategory).sort()) {
  const codes = Object.entries(data.codes);
  const missing = codes.filter(([, v]) => v.status === 'missing').length;
  const hcpcsOnly = codes.filter(([, v]) => v.status === 'in_hcpcs_only').length;
  const inCpt = codes.filter(([, v]) => v.status === 'in_cpt_codes').length;
  console.log(`--- ${cat} (${data.cases} cases) ---`);
  console.log(`  in_cpt: ${inCpt}  hcpcs_only: ${hcpcsOnly}  missing: ${missing}`);
  for (const [code, info] of codes.sort((a, b) => a[1].status.localeCompare(b[1].status))) {
    if (info.status !== 'in_cpt_codes') {
      console.log(`  ${code}: ${info.status} (e.g. ${info.caseIds.slice(0, 2).join(', ')})`);
    }
  }
}

console.log('\n--- All unique expected CPTs ---');
for (const [code, status] of [...allCodes.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  console.log(`  ${code}: ${status}`);
}

const reportPath = path.resolve(__dirname, '../tmp/eval-cpt-coverage-audit.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      cpt_table_size: cptSet.size,
      hcpcs_table_size: hcpcsSet.size,
      by_category: byCategory,
      all_codes: Object.fromEntries(allCodes)
    },
    null,
    2
  )
);
console.log(`\nWrote ${reportPath}\n`);
