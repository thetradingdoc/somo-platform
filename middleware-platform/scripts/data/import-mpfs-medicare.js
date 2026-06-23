#!/usr/bin/env node
'use strict';

/**
 * Import CMS Medicare Physician Fee Schedule allowed amounts into fee_schedules.
 *
 * Download PFS RVU file (CSV) from:
 * https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files
 *
 * Usage:
 *   node scripts/data/import-mpfs-medicare.js --file /path/to/PPRRVU25_JAN.csv
 *   node scripts/data/import-mpfs-medicare.js --file ../../Knowledge/fee-schedules/PPRRVU.csv
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../../database');

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h) {
  return String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findColumn(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i]);
    if (patterns.some((p) => h.includes(p))) return i;
  }
  return -1;
}

function parseAmount(val) {
  if (val == null || val === '') return null;
  const n = parseFloat(String(val).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function main() {
  const filePath = getArg('file');
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('❌ Provide --file path to CMS PFS CSV (see script header for download URL)');
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.error('❌ CSV too short');
    process.exit(1);
  }

  let headerIdx = -1;
  let headers = [];
  let codeCol = -1;
  let priceCol = -1;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const candidate = parseCsvLine(lines[i]);
    const cCol = findColumn(candidate, ['HCPCS', 'CPT']);
    const pCol = findColumn(candidate, ['NONFAC', 'NONFACILITY', 'NONFACL', 'FACILITY', 'PAYMENT', 'AMOUNT']);
    const first = normalizeHeader(candidate[0]);
    if (first === 'HCPCS' && cCol >= 0 && pCol >= 0) {
      headerIdx = i;
      headers = candidate;
      codeCol = cCol;
      priceCol = pCol;
      break;
    }
  }
  if (headerIdx < 0) {
    for (let i = 0; i < lines.length; i++) {
      const candidate = parseCsvLine(lines[i]);
      const cCol = findColumn(candidate, ['HCPCS', 'CPT', 'CODE']);
      const pCol = findColumn(candidate, ['NONFAC', 'NONFACILITY', 'NONFACL', 'FACILITY', 'PAYMENT', 'AMOUNT']);
      if (cCol >= 0 && pCol >= 0) {
        headerIdx = i;
        headers = candidate;
        codeCol = cCol;
        priceCol = pCol;
        break;
      }
    }
  }

  if (codeCol < 0) {
    console.error('❌ Could not find HCPCS/CPT column in CSV headers:', headers.slice(0, 15).join(', '));
    process.exit(1);
  }
  if (priceCol < 0) {
    console.error('❌ Could not find payment/amount column in CSV headers');
    process.exit(1);
  }

  const totalRvuCol = findColumn(headers, ['TOTAL']);
  const factorCol = findColumn(headers, ['FACTOR']);
  const amountCols = headers
    .map((h, i) => (normalizeHeader(h) === 'AMOUNT' ? i : -1))
    .filter((i) => i >= 0);

  function resolveAmount(cols) {
    let amount = parseAmount(cols[priceCol]);
    if (amount != null) return amount;
    for (let j = amountCols.length - 1; j >= 0; j--) {
      amount = parseAmount(cols[amountCols[j]]);
      if (amount != null) return amount;
    }
    if (totalRvuCol >= 0 && factorCol >= 0) {
      const totalRvu = parseFloat(String(cols[totalRvuCol] || '').replace(/,/g, ''));
      const factor = parseFloat(String(cols[factorCol] || '').replace(/,/g, ''));
      if (Number.isFinite(totalRvu) && totalRvu > 0 && Number.isFinite(factor) && factor > 0) {
        return Math.round(totalRvu * factor * 100) / 100;
      }
    }
    return null;
  }

  const items = [];
  const seen = new Set();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const code = String(cols[codeCol] || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{5}$/.test(code)) continue;
    if (seen.has(code)) continue;
    const amount = resolveAmount(cols);
    if (amount == null) continue;
    seen.add(code);
    for (const payerId of ['MEDICARE', 'CMS']) {
      items.push({
        payer_id: payerId,
        cpt_code: code,
        allowed_amount: amount,
        in_network: true,
        source: 'mpfs_import'
      });
    }
  }

  if (items.length === 0) {
    console.error('❌ No fee schedule rows parsed — check CSV format');
    process.exit(1);
  }

  const result = db.bulkUpsertFeeSchedules(items);
  console.log(`✅ MPFS import: ${result.inserted} fee_schedules rows (${seen.size} unique CPT codes × payers MEDICARE/CMS)`);
}

main();
