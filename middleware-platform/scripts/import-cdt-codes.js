#!/usr/bin/env node
/**
 * Import ADA CDT codes into cdt_codes SQLite table (Phase 7.7).
 * Source: Knowledge/CDT/cdt-codes-2025.txt (extend from PDF guides in Knowledge/CDT/)
 * Format: CODE<spaces>Description
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../database');

const CDT_TXT = path.resolve(__dirname, '../../Knowledge/CDT/cdt-codes-2025.txt');
const SOURCE_FILE = 'cdt-codes-2025.txt';

function categoryForCode(code) {
  const n = parseInt(String(code).slice(1), 10);
  if (n >= 100 && n < 1000) return 'Diagnostic';
  if (n >= 1000 && n < 2000) return 'Preventive';
  if (n >= 2000 && n < 3000) return 'Restorative';
  if (n >= 3000 && n < 4000) return 'Endodontics';
  if (n >= 4000 && n < 5000) return 'Periodontics';
  if (n >= 5000 && n < 6000) return 'Prosthodontics';
  if (n >= 6000 && n < 7000) return 'Implant';
  if (n >= 7000 && n < 8000) return 'Oral Surgery';
  if (n >= 8000 && n < 9000) return 'Orthodontics';
  if (n >= 9000) return 'Adjunctive';
  return 'Dental';
}

function parseCdtFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CDT file not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const codes = [];
  const seen = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(D\d{4})\s+(.+)$/i);
    if (!match) continue;
    const code = match[1].toUpperCase();
    const description = match[2].trim();
    if (!description || seen.has(code)) continue;
    seen.add(code);
    codes.push({
      code,
      description,
      category: categoryForCode(code),
      billable: 1,
      source_file: SOURCE_FILE
    });
  }
  return codes;
}

function main() {
  console.log('📥 CDT Import: Starting...');
  console.log(`   Source: ${CDT_TXT}`);
  const codes = parseCdtFile(CDT_TXT);
  console.log(`   Parsed ${codes.length} codes`);
  if (codes.length === 0) {
    console.error('❌ No codes parsed. Aborting.');
    process.exit(1);
  }
  const result = db.bulkUpsertCdtCodes(codes);
  const count = db.getCdtCodesCount?.() ?? result.inserted;
  console.log(`✅ Import complete: ${result.inserted} CDT codes loaded (${count} total in table)`);
}

main();
