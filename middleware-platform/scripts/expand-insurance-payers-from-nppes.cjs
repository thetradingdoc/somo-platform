#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAliases(v) {
  try {
    const arr = JSON.parse(v || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  } catch (_) {
    return [];
  }
}

function main() {
  const nppesRows = db.db.prepare(`
    SELECT raw_npi, MIN(raw_name) AS raw_name
    FROM payor_source_records
    WHERE source = 'nppes_bulk'
      AND raw_npi IS NOT NULL
      AND trim(raw_npi) <> ''
      AND raw_name IS NOT NULL
      AND trim(raw_name) <> ''
    GROUP BY raw_npi
  `).all();

  const existingPayers = db.db.prepare(`
    SELECT id, payer_id, payer_name, aliases
    FROM insurance_payers
    WHERE is_active = 1
  `).all();

  const byNormName = new Map();
  for (const p of existingPayers) {
    const n = normalizeName(p.payer_name);
    if (n && !byNormName.has(n)) byNormName.set(n, p);
  }

  let enrichedExisting = 0;
  let insertedNew = 0;
  let skippedBad = 0;

  for (const r of nppesRows) {
    const npi = String(r.raw_npi || '').trim();
    const rawName = String(r.raw_name || '').trim();
    if (!/^\d{10}$/.test(npi) || !rawName) {
      skippedBad += 1;
      continue;
    }

    const normalized = normalizeName(rawName);
    const existingByName = byNormName.get(normalized) || null;

    if (existingByName) {
      const aliases = new Set(parseAliases(existingByName.aliases));
      aliases.add(rawName);
      aliases.add(`npi:${npi}`);
      db.upsertPayer({
        id: existingByName.id || `payer_${uuidv4()}`,
        payer_id: existingByName.payer_id,
        payer_name: existingByName.payer_name,
        aliases: Array.from(aliases),
        supported_transactions: ['270', '271', '276', '277', '837', '835'],
        is_active: true
      });
      enrichedExisting += 1;
      continue;
    }

    // New payer row seeded from NPPES org.
    db.upsertPayer({
      id: `payer_${uuidv4()}`,
      payer_id: npi,
      payer_name: rawName,
      aliases: [rawName, `npi:${npi}`],
      supported_transactions: ['270', '271', '276', '277', '837', '835'],
      is_active: true
    });
    insertedNew += 1;
  }

  const total = db.getPayerCacheCount();
  console.log(JSON.stringify({
    event: 'insurance_payers_expanded_from_nppes',
    nppes_distinct_org_npis: nppesRows.length,
    enriched_existing_rows: enrichedExisting,
    inserted_new_rows: insertedNew,
    skipped_bad_rows: skippedBad,
    insurance_payers_active_total: total
  }, null, 2));
}

main();
