#!/usr/bin/env node
'use strict';

/**
 * Report identifier coverage in payor_source_records by source.
 *
 * Usage:
 *   DB_PATH=./tmp/payor-tier1-live.db node scripts/report-payor-identifier-coverage.cjs
 *   DB_PATH=./tmp/payor-tier1-live.db node scripts/report-payor-identifier-coverage.cjs --out=./tmp/payor-coverage.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

const projectRoot = path.join(__dirname, '..');
const db = require(path.join(projectRoot, 'database'));

const rows = db.db.prepare(`
  WITH latest_batches AS (
    SELECT source, MAX(created_at) AS max_created_at
    FROM payor_ingest_batches
    WHERE status IN ('completed', 'completed_with_errors')
    GROUP BY source
  )
  SELECT
    r.source,
    COUNT(*) AS total_rows,
    SUM(CASE WHEN raw_npi IS NOT NULL AND TRIM(raw_npi) <> '' THEN 1 ELSE 0 END) AS npi_rows,
    SUM(CASE WHEN raw_payer_id IS NOT NULL AND TRIM(raw_payer_id) <> '' THEN 1 ELSE 0 END) AS payer_id_rows,
    SUM(CASE WHEN raw_ein IS NOT NULL AND TRIM(raw_ein) <> '' THEN 1 ELSE 0 END) AS ein_rows,
    SUM(CASE WHEN raw_state_hint IS NOT NULL AND TRIM(raw_state_hint) <> '' THEN 1 ELSE 0 END) AS state_hint_rows
  FROM payor_source_records r
  JOIN payor_ingest_batches b ON b.id = r.batch_id
  JOIN latest_batches lb ON lb.source = b.source AND lb.max_created_at = b.created_at
  GROUP BY r.source
  ORDER BY total_rows DESC
`).all();

const report = rows.map((r) => {
  const total = Number(r.total_rows || 0) || 1;
  const pct = (n) => Number(((Number(n || 0) / total) * 100).toFixed(2));
  return {
    source: r.source,
    total_rows: Number(r.total_rows || 0),
    npi_rows: Number(r.npi_rows || 0),
    npi_coverage_pct: pct(r.npi_rows),
    payer_id_rows: Number(r.payer_id_rows || 0),
    payer_id_coverage_pct: pct(r.payer_id_rows),
    ein_rows: Number(r.ein_rows || 0),
    ein_coverage_pct: pct(r.ein_rows),
    state_hint_rows: Number(r.state_hint_rows || 0),
    state_hint_coverage_pct: pct(r.state_hint_rows)
  };
});

const payload = {
  generated_at: new Date().toISOString(),
  db_path: process.env.DB_PATH || null,
  source_count: report.length,
  by_source: report
};

const out = getArg('out', null);
if (out) {
  const abs = path.isAbsolute(out) ? out : path.join(projectRoot, out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2));
  console.log(`Coverage report written: ${abs}`);
}

console.log(JSON.stringify(payload, null, 2));

