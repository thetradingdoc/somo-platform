#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const db = require(path.join(projectRoot, 'database'));

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const categories = {
  service_taxonomy: ['taxonomy', 'specialty', 'classification', 'service', 'provider_type'],
  plan_premium_payment: ['plan', 'premium', 'payment', 'enrollment', 'contract', 'benefit'],
  coverage_eligibility: ['coverage', 'eligible', 'eligibility', 'segment', 'network'],
  routing_clearinghouse: ['edi', 'routing', 'receiver', 'submitter', 'clearinghouse', 'payerid', 'payer_id']
};

const rows = db.db.prepare(`
  WITH latest_batches AS (
    SELECT source, MAX(created_at) AS max_created_at
    FROM payor_ingest_batches
    WHERE status IN ('completed', 'completed_with_errors')
    GROUP BY source
  )
  SELECT r.source, r.payload_json
  FROM payor_source_records r
  JOIN payor_ingest_batches b ON b.id = r.batch_id
  JOIN latest_batches lb ON lb.source = b.source AND lb.max_created_at = b.created_at
`).all();

const bySource = new Map();
for (const row of rows) {
  const source = row.source || 'unknown';
  if (!bySource.has(source)) {
    bySource.set(source, {
      source,
      total_rows: 0,
      service_taxonomy_rows: 0,
      plan_premium_payment_rows: 0,
      coverage_eligibility_rows: 0,
      routing_clearinghouse_rows: 0
    });
  }
  const agg = bySource.get(source);
  agg.total_rows += 1;

  let payload = {};
  try {
    payload = row.payload_json ? JSON.parse(row.payload_json) : {};
  } catch (_) {
    payload = {};
  }
  const keys = Object.keys(payload).map((k) => String(k).toLowerCase());
  const hasKeyword = (list) => list.some((k) => keys.some((key) => key.includes(k)));

  if (hasKeyword(categories.service_taxonomy)) agg.service_taxonomy_rows += 1;
  if (hasKeyword(categories.plan_premium_payment)) agg.plan_premium_payment_rows += 1;
  if (hasKeyword(categories.coverage_eligibility)) agg.coverage_eligibility_rows += 1;
  if (hasKeyword(categories.routing_clearinghouse)) agg.routing_clearinghouse_rows += 1;
}

const pct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : 0);
const reportRows = Array.from(bySource.values())
  .map((r) => ({
    ...r,
    service_taxonomy_pct: pct(r.service_taxonomy_rows, r.total_rows),
    plan_premium_payment_pct: pct(r.plan_premium_payment_rows, r.total_rows),
    coverage_eligibility_pct: pct(r.coverage_eligibility_rows, r.total_rows),
    routing_clearinghouse_pct: pct(r.routing_clearinghouse_rows, r.total_rows)
  }))
  .sort((a, b) => b.total_rows - a.total_rows);

const payload = {
  generated_at: new Date().toISOString(),
  db_path: process.env.DB_PATH || null,
  by_source: reportRows
};

const outArg = getArg('out', null);
if (outArg) {
  const outPath = path.isAbsolute(outArg) ? outArg : path.join(projectRoot, outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Business field coverage report written: ${outPath}`);
}

console.log(JSON.stringify(payload, null, 2));

