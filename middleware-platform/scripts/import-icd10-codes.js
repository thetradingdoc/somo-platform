#!/usr/bin/env node
/**
 * Import ICD-10-CM codes from CMS 2020 code descriptions into the local SQLite knowledge base.
 * Source: Knowledge/ICD-10 Files/2020 Code Descriptions/icd10cm_codes_2020.txt
 * Format: CODE<tab/spaces>Description (one per line)
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../database');

const ICD10_DIR = path.resolve(__dirname, '../../Knowledge/ICD-10 Files/2020 Code Descriptions');
const ICD10_TXT = path.join(ICD10_DIR, 'icd10cm_codes_2020.txt');
const SOURCE_FILE = 'icd10cm_codes_2020.txt';

function parseIcd10File(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ICD-10 file not found at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const codes = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: CODE    Description (code is typically 3-7 chars, alphanumeric + .)
    const match = trimmed.match(/^([A-Z0-9][A-Z0-9.]{2,9})\s+(.+)$/i);
    if (!match) continue;

    const code = match[1].trim().toUpperCase();
    const description = match[2].trim();

    if (!code || !description) continue;
    if (seen.has(code)) continue;
    seen.add(code);

    codes.push({
      code,
      description,
      category: null,
      billable: 1,
      source_file: SOURCE_FILE
    });
  }

  return codes;
}

function main() {
  console.log('📥 ICD-10 Import: Starting...');
  console.log(`   Source: ${ICD10_TXT}`);

  const codes = parseIcd10File(ICD10_TXT);
  console.log(`   Parsed ${codes.length} codes`);

  if (codes.length === 0) {
    console.error('❌ No codes parsed. Aborting.');
    process.exit(1);
  }

  const result = db.bulkUpsertIcd10Codes(codes);
  console.log(`✅ Import complete: ${result.inserted} ICD-10 codes loaded`);
}

main();
