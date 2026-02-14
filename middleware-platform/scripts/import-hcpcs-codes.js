#!/usr/bin/env node
/**
 * Import HCPCS codes from CMS 2026 ANWEB fixed-width file into the local SQLite knowledge base.
 * Source: Knowledge/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt
 * Layout: code(1-5), seq(6-10), ric(11), long_desc(12-91), short_desc(92-119), pricing_ind(120-121), ...
 * RIC: 3=procedure first, 4=procedure cont, 7=modifier first, 8=modifier cont
 * Imports only first lines (RIC 3 or 7) to avoid duplication.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../database');

const HCPCS_DIR = path.resolve(__dirname, '../../Knowledge/HCPCS/hcpc2026_jan_anweb_01122026');
const HCPCS_TXT = path.join(HCPCS_DIR, 'HCPC2026_JAN_ANWEB_01122026.txt');
const SOURCE_FILE = 'HCPC2026_JAN_ANWEB_01122026.txt';

function parseHcpcsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`HCPCS file not found at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const codes = [];
  const seen = new Set();

  for (const line of lines) {
    if (line.length < 92) continue;

    const code = line.substring(0, 5).trim();
    const ric = line.substring(10, 11);
    const longDesc = line.substring(11, 91).trim();
    const shortDesc = line.substring(91, 119).trim();
    const pricingInd = line.substring(119, 121).trim() || null;
    const coverageCd = line.length >= 230 ? line.substring(229, 230).trim() || null : null;

    if (!code || !longDesc) continue;
    if (seen.has(code)) continue;

    // Only first lines: RIC 3 = procedure, RIC 7 = modifier
    if (ric !== '3' && ric !== '7') continue;

    seen.add(code);
    codes.push({
      code,
      long_desc: longDesc,
      short_desc: shortDesc || null,
      pricing_ind: pricingInd,
      coverage_cd: coverageCd,
      type: ric === '3' ? 'procedure' : 'modifier',
      source_file: SOURCE_FILE
    });
  }

  return codes;
}

function main() {
  console.log('📥 HCPCS Import: Starting...');
  console.log(`   Source: ${HCPCS_TXT}`);

  const codes = parseHcpcsFile(HCPCS_TXT);
  console.log(`   Parsed ${codes.length} codes`);

  if (codes.length === 0) {
    console.error('❌ No codes parsed. Aborting.');
    process.exit(1);
  }

  const result = db.bulkUpsertHcpcsCodes(codes);
  console.log(`✅ Import complete: ${result.inserted} HCPCS codes loaded`);
}

main();
