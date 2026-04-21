#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return null;
}

function parseRows(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true
  });
}

function main() {
  const input = getArg('input');
  const source = getArg('source', 'cms_ma_provider_directory');
  if (!input || !fs.existsSync(input)) {
    console.error('Usage: node scripts/import-provider-network-evidence.cjs --input=/path/file.csv [--source=cms_ma_provider_directory]');
    process.exit(1);
  }

  const csvText = fs.readFileSync(input, 'utf8');
  const rows = parseRows(csvText);
  const upsertStmt = db.db.prepare(`
    INSERT INTO provider_network_source_records (
      id, source, source_record_id, provider_npi, payer_hint, network_name, network_status,
      effective_start_date, effective_end_date, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, source_record_id) DO UPDATE SET
      provider_npi = COALESCE(excluded.provider_npi, provider_network_source_records.provider_npi),
      payer_hint = COALESCE(excluded.payer_hint, provider_network_source_records.payer_hint),
      network_name = COALESCE(excluded.network_name, provider_network_source_records.network_name),
      network_status = COALESCE(excluded.network_status, provider_network_source_records.network_status),
      effective_start_date = COALESCE(excluded.effective_start_date, provider_network_source_records.effective_start_date),
      effective_end_date = COALESCE(excluded.effective_end_date, provider_network_source_records.effective_end_date),
      payload_json = excluded.payload_json
  `);

  let inserted = 0;
  let skipped = 0;
  const tx = db.db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const npi = pick(row, ['provider_npi', 'npi', 'ProviderNPI', 'NPI']);
      const payerHint = pick(row, ['payer_hint', 'payer_name', 'payor_name', 'payer_id', 'plan_name', 'OrganizationName']);
      if (!npi || !payerHint) {
        skipped++;
        continue;
      }
      const sourceRecordId =
        pick(row, ['source_record_id', 'record_id', 'id']) ||
        `${source}_${npi}_${payerHint}_${i + 1}`;
      const networkStatusRaw = pick(row, ['network_status', 'status', 'participation_status']) || 'unknown';
      upsertStmt.run(
        `prov_net_src_${uuidv4()}`,
        source,
        sourceRecordId,
        npi,
        payerHint,
        pick(row, ['network_name', 'plan_name', 'network']) || null,
        networkStatusRaw.toLowerCase(),
        pick(row, ['effective_start_date', 'effective_date', 'start_date']) || null,
        pick(row, ['effective_end_date', 'end_date', 'termination_date']) || null,
        JSON.stringify(row),
        new Date().toISOString()
      );
      inserted++;
    }
  });

  tx();
  console.log(JSON.stringify({
    event: 'provider_network_evidence_import_completed',
    source,
    input_file: input,
    scanned_rows: rows.length,
    inserted_rows: inserted,
    skipped_rows: skipped
  }, null, 2));
}

main();

