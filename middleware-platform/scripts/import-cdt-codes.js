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
const { isCdtPlaceholderDescription, cdtQualityFromRows } = require('./lib/cdt-description-quality.cjs');

const CDT_TXT = path.resolve(__dirname, '../../Knowledge/CDT/cdt-codes-2025.txt');
const SOURCE_FILE = 'cdt-codes-2025.txt';
const licensedOnly = process.argv.includes('--licensed');

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
  const byCode = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(D\d{4})\s+(.+)$/i);
    if (!match) continue;
    const code = match[1].toUpperCase();
    const description = match[2].trim();
    if (!description) continue;
    const entry = {
      code,
      description,
      category: categoryForCode(code),
      billable: 1,
      source_file: SOURCE_FILE
    };
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, entry);
      continue;
    }
    const existingPlaceholder = isCdtPlaceholderDescription(existing.description);
    const incomingPlaceholder = isCdtPlaceholderDescription(description);
    if (existingPlaceholder && !incomingPlaceholder) {
      byCode.set(code, entry);
    } else if (!existingPlaceholder && incomingPlaceholder) {
      // Keep the better description already parsed for this code.
    } else if (!existingPlaceholder && !incomingPlaceholder && description.length > existing.description.length) {
      byCode.set(code, entry);
    }
  }
  return Array.from(byCode.values());
}

function filterAgainstExisting(codes, sqlite) {
  let getExisting = null;
  try {
    getExisting = sqlite.prepare('SELECT description FROM cdt_codes WHERE code = ?');
  } catch (_) {
    return { codes, skippedDowngrade: 0, flaggedPlaceholders: 0 };
  }

  const filtered = [];
  let skippedDowngrade = 0;
  let flaggedPlaceholders = 0;
  for (const item of codes) {
    const incomingPlaceholder = isCdtPlaceholderDescription(item.description);
    if (incomingPlaceholder) flaggedPlaceholders++;
    const row = getExisting.get(item.code);
    if (row && incomingPlaceholder && !isCdtPlaceholderDescription(row.description)) {
      skippedDowngrade++;
      continue;
    }
    filtered.push(item);
  }
  return { codes: filtered, skippedDowngrade, flaggedPlaceholders };
}

function synthesizeAdaCdtRange(byCode) {
  const dentalMap = require('../../Knowledge/rules/dental-phrase-map.json');
  for (const entry of dentalMap.entries || []) {
    if (!entry.code) continue;
    const code = String(entry.code).toUpperCase();
    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        description: `${entry.id.replace(/_/g, ' ')} (${code})`,
        category: categoryForCode(code),
        billable: 1,
        source_file: 'dental-phrase-map.json'
      });
    }
  }
  for (let n = 100; n <= 9999; n++) {
    const code = `D${String(n).padStart(4, '0')}`;
    if (byCode.has(code)) continue;
    const cat = categoryForCode(code);
    byCode.set(code, {
      code,
      description: `${cat} — ADA CDT ${code}`,
      category: cat,
      billable: 1,
      source_file: 'synthesized-ada-range'
    });
  }
  return Array.from(byCode.values());
}

function main() {
  console.log('📥 CDT Import: Starting...');
  console.log(`   Source: ${CDT_TXT}`);
  if (licensedOnly) {
    console.log('   Mode: --licensed (real ADA descriptions from source file only)');
  }
  const parsedMap = new Map(parseCdtFile(CDT_TXT).map((c) => [c.code, c]));
  const parsed = licensedOnly
    ? Array.from(parsedMap.values()).filter((c) => !isCdtPlaceholderDescription(c.description))
    : synthesizeAdaCdtRange(parsedMap);
  const parsedQuality = cdtQualityFromRows(parsed);
  console.log(`   Parsed ${parsed.length} codes`);
  console.log(
    `   Parsed quality: ${parsedQuality.non_placeholder}/${parsedQuality.total} non-placeholder (${parsedQuality.quality_ratio.toFixed(4)})`
  );
  if (parsedQuality.placeholder > 0) {
    console.log(`   ⚠️  ${parsedQuality.placeholder} placeholder descriptions in source (e.g. "diagnostic procedure D0100")`);
  }
  if (parsed.length === 0) {
    console.error('❌ No codes parsed. Aborting.');
    process.exit(1);
  }
  if (licensedOnly && parsed.length < 50) {
    console.warn(`   ⚠️  --licensed mode: only ${parsed.length} non-placeholder codes in ${SOURCE_FILE}`);
  }

  const sqlite = db.db || db;
  const { codes, skippedDowngrade, flaggedPlaceholders } = filterAgainstExisting(parsed, sqlite);
  if (skippedDowngrade > 0) {
    console.log(`   Skipped ${skippedDowngrade} placeholder row(s) — existing table has better descriptions`);
  }
  if (flaggedPlaceholders > 0 && flaggedPlaceholders === parsed.length) {
    console.log('   NOTE: Source is mostly placeholders; extend Knowledge/CDT/cdt-codes-2025.txt with real ADA descriptions');
  }

  const result = db.bulkUpsertCdtCodes(codes);
  const count = db.getCdtCodesCount?.() ?? result.inserted;
  const tableQuality = cdtQualityFromRows(sqlite.prepare('SELECT description FROM cdt_codes').all());
  console.log(`✅ Import complete: ${result.inserted} CDT codes upserted (${count} total in table)`);
  console.log(
    `   Table quality: ${tableQuality.non_placeholder}/${tableQuality.total} non-placeholder (${tableQuality.quality_ratio.toFixed(4)})`
  );
}

main();
