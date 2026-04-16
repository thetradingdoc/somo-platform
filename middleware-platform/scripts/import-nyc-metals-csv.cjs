#!/usr/bin/env node
'use strict';

/**
 * Import NYC Health Dept. consumer metal tests CSV into SQLite.
 *
 *   node scripts/import-nyc-metals-csv.cjs /path/to/Metal_Content_....csv [--dataset-version=20260411]
 *
 * Requires middleware-platform DB (same env as server, e.g. DB_PATH).
 */

const fs = require('fs');
const path = require('path');
const { normalizeProductName, parseConcentration } = require('../services/nyc-metal-context-service');

function parseArgs(argv) {
  const csvPath = argv.find((a) => !a.startsWith('--') && a.endsWith('.csv'));
  let datasetVersion = '20260411';
  for (const a of argv) {
    if (a.startsWith('--dataset-version=')) datasetVersion = a.split('=')[1] || datasetVersion;
  }
  return { csvPath, datasetVersion };
}

/** Minimal CSV field splitter respecting double-quoted fields. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && inQ && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function main() {
  const { csvPath, datasetVersion } = parseArgs(process.argv.slice(2));
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: node scripts/import-nyc-metals-csv.cjs /path/to/file.csv [--dataset-version=20260411]');
    process.exit(1);
  }

  const db = require('../database').db;
  const tbl = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='nyc_consumer_metal_tests'`).get();
  if (!tbl) {
    console.error('Table nyc_consumer_metal_tests missing. Run: npm run migrate');
    process.exit(1);
  }

  const insert = db.prepare(`
    INSERT INTO nyc_consumer_metal_tests (
      source_row_id, product_type, product_name, product_name_normalized, metal,
      concentration_ppm, is_not_detected, units, manufacturer, made_in_country, purchase_country,
      collection_date, investigation_type, dataset_version
    ) VALUES (
      @source_row_id, @product_type, @product_name, @product_name_normalized, @metal,
      @concentration_ppm, @is_not_detected, @units, @manufacturer, @made_in_country, @purchase_country,
      @collection_date, @investigation_type, @dataset_version
    )
  `);

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    console.error('CSV empty');
    process.exit(1);
  }

  db.prepare('DELETE FROM nyc_consumer_metal_tests WHERE dataset_version = ?').run(datasetVersion);

  const run = db.transaction(() => {
    let n = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 11) continue;
      const [
        rowId,
        productType,
        productName,
        metal,
        concentration,
        units,
        manufacturer,
        madeIn,
        purchaseCountry,
        collectionDate,
        investigation
      ] = cols;
      const m = String(metal || '').trim();
      if (!m) continue;
      const { ppm, isNotDetected } = parseConcentration(concentration);
      const pn = String(productName || '').trim();
      if (!pn) continue;
      insert.run({
        source_row_id: String(rowId || '').trim() || null,
        product_type: String(productType || '').trim() || null,
        product_name: pn.slice(0, 500),
        product_name_normalized: normalizeProductName(pn).slice(0, 500),
        metal: m.slice(0, 80),
        concentration_ppm: ppm,
        is_not_detected: isNotDetected ? 1 : 0,
        units: String(units || '').trim().slice(0, 32) || null,
        manufacturer: String(manufacturer || '').trim().slice(0, 300) || null,
        made_in_country: String(madeIn || '').trim().slice(0, 120) || null,
        purchase_country: String(purchaseCountry || '').trim().slice(0, 120) || null,
        collection_date: String(collectionDate || '').trim().slice(0, 64) || null,
        investigation_type: String(investigation || '').trim().slice(0, 32) || null,
        dataset_version: datasetVersion
      });
      n++;
    }
    return n;
  });

  const count = run();
  console.log(`Imported ${count} rows (dataset_version=${datasetVersion}) from ${path.basename(csvPath)}`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
