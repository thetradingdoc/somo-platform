#!/usr/bin/env node
'use strict';

/**
 * PY-01 / 4b-05 — Refresh COVERAGE_MATRIX.md from plan_rules ingest.
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/refresh-coverage-matrix.cjs
 *   node scripts/import-plan-rules-benefits.cjs ../Knowledge/rules/plan-rules-benefits-scale.json
 *   node scripts/refresh-coverage-matrix.cjs
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const db = require('../database').db;
const OUT = path.resolve(__dirname, '../../docs/Medical Coding/COVERAGE_MATRIX.md');

const PAYERS = ['BCBS_NY', 'AETNA', 'UHC', 'DELTA_DENTAL_NY'];
const VISIT_TYPES = [
  { key: 'new_em', codes: ['99203', '99204'] },
  { key: 'est_em', codes: ['99213', '99214'] },
  { key: 'mh', codes: ['90834', '90837'] },
  { key: 'wellness', codes: ['G0438', 'G0439'] },
  { key: 'dental', codes: ['D1110', 'D4341'] }
];

function fmtCopay(row) {
  if (!row) return '—';
  const v = row.copay_value;
  if (v === 0) return '$0';
  return `$${v}`;
}

function lookup(payerId, codes) {
  for (const code of codes) {
    const row = db.prepare(`
      SELECT copay_value FROM plan_rules
      WHERE payer_id = ? AND code_pattern = ?
      ORDER BY effective_date DESC LIMIT 1
    `).get(payerId, code);
    if (row) return row;
  }
  return null;
}

function main() {
  const lines = [
    '# Coverage matrix (patient-facing copay grid)',
    '',
    `**Status:** Populated by PY-01 ingest — refreshed ${new Date().toISOString().slice(0, 10)}`,
    '',
    '**SSOT:** This file, refreshed on each `plan_rules` ingest via `scripts/refresh-coverage-matrix.cjs`.',
    '',
    '| Visit type | BCBS | Aetna | UHC | Delta Dental | Notes |',
    '|------------|------|-------|-----|--------------|-------|'
  ];

  const label = {
    new_em: 'New E/M',
    est_em: 'Est E/M',
    mh: 'MH (90834)',
    wellness: 'Wellness',
    dental: 'Dental (CDT)'
  };

  for (const vt of VISIT_TYPES) {
    const cells = PAYERS.map((p) => {
      if (vt.key === 'dental' && !p.includes('DENTAL') && p !== 'DELTA_DENTAL_NY') return 'N/A';
      if (vt.key !== 'dental' && p.includes('DENTAL')) return 'N/A';
      const payer = p === 'BCBS_NY' ? 'BCBS_NY' : p === 'AETNA' ? 'AETNA' : p === 'UHC' ? 'UHC' : 'DELTA_DENTAL_NY';
      return fmtCopay(lookup(payer, vt.codes));
    });
    lines.push(`| ${label[vt.key]} | ${cells.join(' | ')} | plan_rules |`);
  }

  lines.push('', '*Regenerate: `npm run refresh:coverage-matrix`*');
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`✅ Wrote ${OUT}`);
}

main();
