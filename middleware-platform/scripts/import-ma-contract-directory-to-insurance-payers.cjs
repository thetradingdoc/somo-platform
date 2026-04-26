#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function normalizeString(v) {
  const s = String(v || '').trim();
  return s.length ? s : null;
}

function defaultCsvPath() {
  return '/Users/ojrichard/Downloads/MA_Plan_Directory_2026_04 2/MA_Contract_directory_2026_04.csv';
}

function main() {
  const csvPath = path.resolve(getArg('file', defaultCsvPath()));
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, bom: true });

  let upserted = 0;
  let skipped = 0;
  const seen = new Set();

  for (const row of rows) {
    const contractNumber = normalizeString(row['Contract Number']);
    const marketingName = normalizeString(row['Organization Marketing Name']);
    const legalName = normalizeString(row['Legal Entity Name']);
    if (!contractNumber || !(marketingName || legalName)) {
      skipped += 1;
      continue;
    }

    const payerId = contractNumber;
    if (seen.has(payerId)) continue;
    seen.add(payerId);

    const aliasSet = new Set([marketingName, legalName].filter(Boolean));
    db.upsertPayer({
      id: `payer_${uuidv4()}`,
      payer_id: payerId,
      payer_name: marketingName || legalName,
      aliases: Array.from(aliasSet),
      supported_transactions: ['270', '271', '276', '277', '837', '835'],
      is_active: true
    });
    upserted += 1;
  }

  console.log(JSON.stringify({
    event: 'ma_contract_directory_import_completed',
    file: csvPath,
    rows_read: rows.length,
    payer_rows_upserted: upserted,
    rows_skipped: skipped,
    insurance_payers_active_total: db.getPayerCacheCount()
  }, null, 2));
}

main();
