#!/usr/bin/env node
'use strict';

/**
 * Step 0–2 readiness gates. By default requires Office Ally + Inovalon batches.
 *
 * CMS-only / vendor-unavailable track: set one of:
 *   PAYOR_READINESS_VENDOR_MODE=cms_only
 *   PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1
 * Vendor gates are then **waived** (explicit in report; overall pass ignores them).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');

function resolveRepoFile(relFromRepoRoot) {
  const candidates = [
    path.join(process.cwd(), relFromRepoRoot),
    path.join(process.cwd(), '..', relFromRepoRoot),
    path.join(__dirname, '..', '..', relFromRepoRoot)
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function latestBatch(source) {
  return db.db.prepare(`
    SELECT id, source, file_name, created_at, record_count, status
    FROM payor_ingest_batches
    WHERE source = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(source);
}

function coverageForBatch(batchId) {
  if (!batchId) return null;
  return db.db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN raw_name IS NOT NULL AND TRIM(raw_name) <> '' THEN 1 ELSE 0 END) AS raw_name,
      SUM(CASE WHEN raw_payer_id IS NOT NULL AND TRIM(raw_payer_id) <> '' THEN 1 ELSE 0 END) AS raw_payer_id,
      SUM(CASE WHEN raw_npi IS NOT NULL AND TRIM(raw_npi) <> '' THEN 1 ELSE 0 END) AS raw_npi,
      SUM(CASE WHEN raw_ein IS NOT NULL AND TRIM(raw_ein) <> '' THEN 1 ELSE 0 END) AS raw_ein,
      SUM(CASE WHEN raw_state_hint IS NOT NULL AND TRIM(raw_state_hint) <> '' THEN 1 ELSE 0 END) AS raw_state_hint
    FROM payor_source_records
    WHERE batch_id = ?
  `).get(batchId);
}

function pct(n, d) {
  const den = Number(d || 0);
  if (!den) return 0;
  return Number(((Number(n || 0) / den) * 100).toFixed(2));
}

function truthyEnv(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase().trim());
}

function gate(id, pass, detail, waived = false) {
  return {
    id,
    pass: waived ? true : Boolean(pass),
    detail: waived ? `${detail} (waived)` : detail,
    waived: Boolean(waived)
  };
}

function main() {
  const vendorMode = String(process.env.PAYOR_READINESS_VENDOR_MODE || '').trim().toLowerCase();
  const cmsOnly =
    vendorMode === 'cms_only' ||
    vendorMode === 'cms-only' ||
    truthyEnv('PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY');

  const office = latestBatch('office_ally');
  const inovalon = latestBatch('inovalon');
  const officeCov = coverageForBatch(office?.id);
  const inovalonCov = coverageForBatch(inovalon?.id);

  const normBySource = db.db.prepare(`
    SELECT source, COUNT(*) AS c
    FROM payor_normalized_records
    GROUP BY source
  `).all();
  const normMap = new Map(normBySource.map((r) => [r.source, Number(r.c || 0)]));

  const waiveVendor = cmsOnly;
  const waiveDetail = 'CMS-authoritative track; Office Ally/Inovalon not required until export is procured';

  const gates = [
    gate(
      'step0_naming_convention_doc_exists',
      fs.existsSync(resolveRepoFile('docs/Payor/PAYOR_NAMING_CONVENTION.md')),
      'Naming decision doc must exist.'
    ),
    gate(
      'step1_office_ally_latest_batch_exists',
      Boolean(office),
      office ? `batch=${office.id}` : 'No Office Ally batch found.',
      waiveVendor
    ),
    gate(
      'step1_inovalon_latest_batch_exists',
      Boolean(inovalon),
      inovalon ? `batch=${inovalon.id}` : 'No Inovalon batch found.',
      waiveVendor
    ),
    gate(
      'step1_office_ally_raw_name_coverage_gte_95',
      pct(officeCov?.raw_name, officeCov?.total) >= 95,
      `raw_name_coverage=${pct(officeCov?.raw_name, officeCov?.total)}%`,
      waiveVendor
    ),
    gate(
      'step1_inovalon_raw_name_coverage_gte_95',
      pct(inovalonCov?.raw_name, inovalonCov?.total) >= 95,
      `raw_name_coverage=${pct(inovalonCov?.raw_name, inovalonCov?.total)}%`,
      waiveVendor
    ),
    gate(
      'step2_office_ally_normalized_rows_gt_0',
      Number(normMap.get('office_ally') || 0) > 0,
      `normalized_rows=${Number(normMap.get('office_ally') || 0)}`,
      waiveVendor
    ),
    gate(
      'step2_inovalon_normalized_rows_gt_0',
      Number(normMap.get('inovalon') || 0) > 0,
      `normalized_rows=${Number(normMap.get('inovalon') || 0)}`,
      waiveVendor
    )
  ];

  const applicable = gates.filter((g) => !g.waived);
  const out = {
    generated_at: new Date().toISOString(),
    db_path: process.env.DB_PATH || null,
    vendor_readiness_mode: cmsOnly ? 'cms_only' : 'full',
    gates,
    pass: applicable.length ? applicable.every((g) => g.pass) : true,
    context: {
      office_ally_policy: cmsOnly ? 'waived_until_export' : 'required',
      inovalon_policy: cmsOnly ? 'waived_until_export' : 'required',
      waive_detail: cmsOnly ? waiveDetail : null,
      office_latest_batch: office || null,
      office_latest_coverage: officeCov || null,
      inovalon_latest_batch: inovalon || null,
      inovalon_latest_coverage: inovalonCov || null,
      normalized_by_source: Object.fromEntries(normMap)
    }
  };

  const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-step0-2-readiness-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Readiness report written: ${outPath}`);
  console.log(JSON.stringify(out, null, 2));
}

main();

