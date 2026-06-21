#!/usr/bin/env node
/**
 * Import ICD-10-PCS codes from CMS FY2025 Codes File into SQLite.
 *
 * Source (official CMS, free):
 *   https://www.cms.gov/medicare/coding-billing/icd-10-codes
 *   → 2025 ICD-10-PCS Codes File (ZIP) → icd10pcs_codes_2025.txt
 *
 * Local path:
 *   Knowledge/ICD-10-PCS/FY2025/icd10pcs_codes_2025.txt
 *
 * Format: 7-char code + space + long title (fixed-width code column)
 *
 * Usage:
 *   DB_PATH=./var/db/middleware-dev.db node scripts/import-icd10-pcs-codes.js
 *   node scripts/import-icd10-pcs-codes.js --download   # fetch CMS zip first
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const db = require('../database');
const { up: m083 } = require('../migrations/083_icd10_pcs_codes');

const PCS_DIR = path.resolve(__dirname, '../../Knowledge/ICD-10-PCS/FY2025');
const PCS_TXT = path.join(PCS_DIR, 'icd10pcs_codes_2025.txt');
const SOURCE_FILE = 'icd10pcs_codes_2025.txt';
const CMS_ZIP_URL = 'https://www.cms.gov/files/zip/2025-icd-10-pcs-codes-file.zip';

function downloadPcsFile() {
  fs.mkdirSync(PCS_DIR, { recursive: true });
  const zipPath = path.join(PCS_DIR, 'pcs_codes_2025.zip');
  console.log(`📥 Downloading ${CMS_ZIP_URL} ...`);
  execSync(`curl -sL -o "${zipPath}" "${CMS_ZIP_URL}"`, { stdio: 'inherit' });
  execSync(`unzip -o "${zipPath}" -d "${PCS_DIR}"`, { stdio: 'inherit' });
}

function parsePcsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ICD-10-PCS file not found at ${filePath}. Run with --download or place CMS file manually.`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const codes = [];
  const seen = new Set();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 9) continue;

    const code = trimmed.slice(0, 7).trim().toUpperCase();
    const description = trimmed.slice(7).trim();

    if (!/^[0-9A-HJ-NP-Z]{7}$/.test(code)) continue;
    if (!description || seen.has(code)) continue;
    seen.add(code);

    codes.push({ code, description, source_file: SOURCE_FILE });
  }

  return codes;
}

function main() {
  if (process.argv.includes('--download')) {
    downloadPcsFile();
  }

  m083(db.db);

  console.log('📥 ICD-10-PCS Import: Starting...');
  console.log(`   Source: ${PCS_TXT}`);

  const codes = parsePcsFile(PCS_TXT);
  console.log(`   Parsed ${codes.length} codes`);

  if (codes.length === 0) {
    console.error('❌ No codes parsed. Aborting.');
    process.exit(1);
  }

  const result = db.bulkUpsertIcd10PcsCodes(codes);
  const count = db.getIcd10PcsCodesCount?.() ?? db.db.prepare('SELECT COUNT(*) AS n FROM icd10_pcs_codes').get()?.n;
  console.log(`✅ Import complete: ${result.inserted} rows upserted (${count} total in icd10_pcs_codes)`);
}

main();
