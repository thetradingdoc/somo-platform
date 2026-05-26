#!/usr/bin/env node
/**
 * Import CPT codes into cpt_codes.
 *
 * Sources:
 *   mpfs  — CMS Physician Fee Schedule RVU file (RVU26A / PPRRVU) — recommended (~10k Medicare-payable codes)
 *   dhs   — Medicare DHS addendum only (~1,299 codes; missing E/M 99202–99215)
 *   merge — MPFS first, then DHS codes not already present
 *
 * Usage:
 *   node scripts/import-cpt-codes.js --source mpfs --file ../../Knowledge/fee-schedules/PPRRVU.csv
 *   node scripts/import-cpt-codes.js --source mpfs
 *   node scripts/import-cpt-codes.js --source dhs
 *   node scripts/import-cpt-codes.js --source merge
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';

const db = require('../database');
const { parsePfsRvuFile, resolveDefaultPfsFile } = require('../lib/pfs-rvu-parse');

const CPT_DIR = path.resolve(__dirname, '../../Knowledge/CPT');
const CPT_XLSX_PATH = path.join(CPT_DIR, '2025_DHS_Code_List_Addendum_11_26_2024.xlsx');
const CPT_TEXT_PATH = path.join(CPT_DIR, '2025_DHS_Code_List_Addendum_11_26_2024.txt');

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function getSourceFlag() {
  const src = (getArg('source') || process.env.CPT_IMPORT_SOURCE || 'mpfs').toLowerCase();
  if (['mpfs', 'dhs', 'merge'].includes(src)) return src;
  return 'mpfs';
}

function normalizeCode(code) {
  if (!code) return null;
  const cleaned = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!cleaned) return null;
  if (!/^[A-Z0-9]{3,7}$/.test(cleaned)) return null;
  return cleaned;
}

function parseCptFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CPT file not found at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let currentCategory = 'Clinical Laboratory Services';
  const codes = [];
  const seen = new Set();

  const skipPatterns = [
    /^LIST OF CPT/i,
    /^This code list is effective/i,
    /^CLINICAL LABORATORY SERVICES/i,
    /^INCLUDE CPT codes/i,
    /^EXCLUDE CPT codes/i,
    /^INCLUDE the following/i,
    /^RADIOLOGY SERVICES/i,
    /^PHYSICAL THERAPY SERVICES/i,
    /^OCCUPATIONAL THERAPY SERVICES/i,
    /^SPEECH-LANGUAGE PATHOLOGY SERVICES/i,
    /^DURABLE MEDICAL EQUIPMENT/i,
    /^PROSTHETICS/i,
    /^ORTHOTICS/i,
    /^HOME HEALTH SERVICES/i,
    /^PERSONAL CARE SERVICES/i,
    /^AMBULANCE SERVICES/i,
    /^SUPPLIES/i,
    /^OTHER SERVICES/i
  ];

  for (let rawLine of lines) {
    if (!rawLine) continue;
    let line = rawLine.replace(/\u00A0/g, ' ').trim();
    if (!line) continue;

    if (skipPatterns.some((pattern) => pattern.test(line))) {
      if (/^CLINICAL LABORATORY/i.test(line)) currentCategory = 'Clinical Laboratory Services';
      else if (/^RADIOLOGY/i.test(line)) currentCategory = 'Radiology Services';
      else if (/^PHYSICAL THERAPY/i.test(line)) currentCategory = 'Physical Therapy';
      else if (/^OCCUPATIONAL THERAPY/i.test(line)) currentCategory = 'Occupational Therapy';
      else if (/^SPEECH/i.test(line)) currentCategory = 'Speech Therapy';
      else if (/^DURABLE MEDICAL/i.test(line)) currentCategory = 'Durable Medical Equipment';
      else if (/^PROSTHETICS/i.test(line)) currentCategory = 'Prosthetics';
      else if (/^ORTHOTICS/i.test(line)) currentCategory = 'Orthotics';
      else if (/^HOME HEALTH/i.test(line)) currentCategory = 'Home Health';
      else if (/^AMBULANCE/i.test(line)) currentCategory = 'Ambulance Services';
      else if (/^SUPPLIES/i.test(line)) currentCategory = 'Supplies';
      else if (/^OTHER SERVICES/i.test(line)) currentCategory = 'Other Services';
      continue;
    }

    if (line.startsWith('"') && line.endsWith('"')) {
      const inner = line.replace(/^"|"$/g, '').trim();
      if (inner.length > 100 || /^INCLUDE|^EXCLUDE/i.test(inner)) continue;
    }

    const parts = rawLine.split(/\t+/).map((p) => p.trim()).filter(Boolean);
    let code = null;
    let description = null;

    if (parts.length >= 2) {
      code = normalizeCode(parts[0]);
      description = parts.slice(1).join(' ').replace(/"/g, '').trim();
    } else {
      const match = line.match(/^([0-9A-Za-z]{4,7})\s+(.+)$/);
      if (match) {
        code = normalizeCode(match[1]);
        description = match[2].replace(/"/g, '').trim();
      }
    }

    if (!code || !description || description.length < 3) continue;
    if (code.length > 7 || /^[A-Z]{10,}$/.test(code)) continue;
    if (description.length > 200) continue;
    if (/^(LIST|THIS|INCLUDE|EXCLUDE|CLINICAL|RADIOLOGY|PHYSICAL|OCCUPATIONAL|SPEECH|DURABLE|PROSTHETICS|ORTHOTICS|HOME|AMBULANCE|SUPPLIES|OTHER)/i.test(description)) {
      continue;
    }
    if (seen.has(code)) continue;

    codes.push({
      code,
      description,
      category: currentCategory,
      subcategory: null,
      is_new: /\bNEW\b/i.test(description)
    });
    seen.add(code);
  }

  return codes;
}

function parseCptFromXlsx(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const codes = [];
  const seen = new Set();
  let codeCol = 0;
  let descCol = 1;
  let catCol = -1;

  if (rows.length < 2) return codes;

  const header = rows[0].map((h) => String(h || '').toLowerCase());
  if (header.some((h) => h.includes('code') || h.includes('hcpcs') || h.includes('cpt'))) {
    codeCol = header.findIndex((h) => /code|hcpcs|cpt/i.test(h));
    if (codeCol < 0) codeCol = 0;
  }
  if (header.some((h) => h.includes('desc') || h.includes('description') || h.includes('long'))) {
    descCol = header.findIndex((h) => /desc|long|name/i.test(h));
    if (descCol < 0) descCol = 1;
  }
  if (header.some((h) => h.includes('category') || h.includes('type') || h.includes('section'))) {
    catCol = header.findIndex((h) => /category|type|section/i.test(h));
  }

  let currentCategory = 'General';
  for (let i = 1; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const rawCode = row[codeCol];
    const code = normalizeCode(rawCode != null ? String(rawCode) : '');
    const description = String(row[descCol] || '').trim();
    const category = catCol >= 0 && row[catCol] ? String(row[catCol]).trim() : currentCategory;
    if (category && category.length < 100) currentCategory = category;

    if (!code || !description || description.length < 3) continue;
    if (code.length > 7) continue;
    if (seen.has(code)) continue;
    if (/^(LIST|INCLUDE|EXCLUDE|CLINICAL|RADIOLOGY)/i.test(description)) continue;

    codes.push({
      code,
      description: description.slice(0, 500),
      category: currentCategory,
      subcategory: null,
      is_new: /\bNEW\b/i.test(description)
    });
    seen.add(code);
  }
  return codes;
}

function loadDhsCptCodes() {
  if (fs.existsSync(CPT_XLSX_PATH)) {
    console.log('📂 DHS xlsx:', path.basename(CPT_XLSX_PATH));
    return parseCptFromXlsx(CPT_XLSX_PATH);
  }
  if (fs.existsSync(CPT_TEXT_PATH)) {
    console.log('📂 DHS txt:', path.basename(CPT_TEXT_PATH));
    return parseCptFile(CPT_TEXT_PATH);
  }
  throw new Error(`No DHS CPT file found in ${CPT_DIR}`);
}

function loadMpfsCptCodes(filePath) {
  const resolved = filePath || resolveDefaultPfsFile();
  if (!resolved) {
    throw new Error(
      'No PFS RVU file found. Place RVU26A.csv or PPRRVU.csv under Knowledge/fee-schedules/ or pass --file'
    );
  }
  console.log('📂 PFS RVU:', path.basename(resolved));
  const { codes, stats } = parsePfsRvuFile(resolved);
  console.log(
    `   Parsed ${stats.parsed} codes (${stats.delimiter}, skipped ${stats.skipped_modifier_rows} modifier rows)`
  );
  return codes;
}

function verifyEmCodes() {
  const check = ['99213', '99214', '90834', '99202', '99203'];
  const sqlite = db.db || db;
  const found = [];
  const missing = [];
  for (const code of check) {
    const row = sqlite.prepare('SELECT code FROM cpt_codes WHERE code = ?').get(code);
    if (row) found.push(code);
    else missing.push(code);
  }
  const total = sqlite.prepare('SELECT COUNT(*) AS n FROM cpt_codes').get();
  console.log(`📊 cpt_codes total: ${total?.n ?? 0}`);
  console.log(`   E/M check found: ${found.join(', ') || '(none)'}`);
  if (missing.length) console.warn(`   E/M check missing: ${missing.join(', ')}`);
  return missing.length === 0;
}

function upsertCodes(codes) {
  if (!codes.length) return 0;
  db.bulkUpsertCptCodes(codes);
  return codes.length;
}

function main() {
  const source = getSourceFlag();
  const filePath = getArg('file');

  try {
    let total = 0;

    if (source === 'dhs') {
      total = upsertCodes(loadDhsCptCodes());
    } else if (source === 'mpfs') {
      total = upsertCodes(loadMpfsCptCodes(filePath));
    } else if (source === 'merge') {
      const mpfs = loadMpfsCptCodes(filePath);
      const mpfsSet = new Set(mpfs.map((c) => c.code));
      total += upsertCodes(mpfs);
      try {
        const dhs = loadDhsCptCodes().filter((c) => !mpfsSet.has(c.code));
        if (dhs.length) {
          console.log(`📂 DHS supplement: ${dhs.length} codes not in MPFS`);
          total += upsertCodes(dhs);
        }
      } catch (e) {
        console.warn('⚠️  DHS supplement skipped:', e.message);
      }
    } else {
      throw new Error(`Unknown --source ${source}`);
    }

    if (total === 0) {
      console.warn('⚠️  No codes imported.');
      process.exit(1);
    }

    console.log(`✅ Imported ${total} CPT code records (${source})`);
    const ok = verifyEmCodes();
    if (!ok && source !== 'dhs') {
      console.warn('⚠️  Some expected E/M codes still missing — check PFS file format');
    }
  } catch (error) {
    console.error('❌ Failed to import CPT codes:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCptFile,
  parseCptFromXlsx,
  loadDhsCptCodes,
  loadMpfsCptCodes,
  CPT_TEXT_PATH,
  CPT_XLSX_PATH
};
