#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const { buildBlockingCandidates, DEFAULT_SOURCES } = require('../services/payor-blocking-service');
const db = require('../database');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const sourceArg = getArg('sources', '');
const sources = sourceArg
  ? sourceArg.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_SOURCES;
const normalizationVersion = getArg('version', 'v1');
const maxBucketSize = Number(getArg('max-bucket', '500')) || 500;
const enforceCrossSourceOnly = getArg('enforce-cross-source-only', 'true') !== 'false';

const out = buildBlockingCandidates({ sources, normalizationVersion, maxBucketSize, enforceCrossSourceOnly });
try {
  db.db.prepare(`
    INSERT INTO payor_audit_log (
      id, event_type, policy_version, payload_json, created_at
    ) VALUES (?, 'blocking_report', ?, ?, ?)
  `).run(
    `payor_audit_${uuidv4()}`,
    normalizationVersion,
    JSON.stringify({
      batch_id: out.batch_id,
      naive_pair_count: out.naive_pair_count,
      candidate_pair_count: out.candidate_pair_count,
      reduction_ratio_pct: out.reduction_ratio_pct
    }),
    new Date().toISOString()
  );
} catch (_) {}
const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-blocking-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  event: 'payor_blocking_run_completed',
  max_bucket_size: maxBucketSize,
  enforce_cross_source_only: enforceCrossSourceOnly,
  ...out
}, null, 2));

console.log(`Blocking report written: ${outPath}`);
console.log(JSON.stringify({
  event: 'payor_blocking_run_completed',
  max_bucket_size: maxBucketSize,
  enforce_cross_source_only: enforceCrossSourceOnly,
  ...out
}, null, 2));

if (enforceCrossSourceOnly && Number(out.same_source_pair_count || 0) > 0) {
  console.error(`Blocking validation failed: same_source_pair_count=${out.same_source_pair_count} while enforce_cross_source_only=true`);
  process.exit(2);
}

