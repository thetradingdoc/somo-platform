#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { runCompositeScoring } = require('../services/payor-resolution-scoring-service');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function buildPolicy({ policyVersion, profile }) {
  if (profile === 'tuned_v2') {
    return {
      version: policyVersion,
      weights: {
        // Raise fuzzy contribution for low-ID datasets; keep ID exact boosts available.
        npi_exact: 0.2,
        payer_id_exact: 0.2,
        fuzzy_agreement: 1.0
      },
      penalties: {
        state_mismatch: 0.05
      },
      thresholds: {
        auto_merge_min: 0.85,
        merge_review_min: 0.52,
        review_min: 0.35
      }
    };
  }
  return {
    version: policyVersion,
    weights: { npi_exact: 0.4, payer_id_exact: 0.3, fuzzy_agreement: 0.2 },
    penalties: { state_mismatch: 0.1 },
    thresholds: { auto_merge_min: 0.9, merge_review_min: 0.7, review_min: 0.4 }
  };
}

const batchId = getArg('batch-id', null);
const scorerVersionArg = getArg('scorer-version', 'v1');
const scorerVersion = ['all', 'any', '*', 'none', 'null', ''].includes(String(scorerVersionArg || '').toLowerCase())
  ? null
  : scorerVersionArg;
const policyVersion = getArg('policy-version', 'v1');
const policyProfile = getArg('policy-profile', 'default');
const limit = Number(getArg('limit', '50000')) || 50000;
const offset = Number(getArg('offset', '0')) || 0;

const policy = buildPolicy({ policyVersion, profile: policyProfile });

const out = runCompositeScoring({
  batchId,
  scorerVersion,
  policy,
  limit,
  offset
});

const agg = db.db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN decision = 'auto_merge' THEN 1 ELSE 0 END) AS auto_merge_count,
    SUM(CASE WHEN decision = 'merge_review_flag' THEN 1 ELSE 0 END) AS merge_review_count,
    SUM(CASE WHEN decision = 'review_candidate' THEN 1 ELSE 0 END) AS review_count,
    SUM(CASE WHEN decision = 'distinct' THEN 1 ELSE 0 END) AS distinct_count,
    AVG(final_score) AS avg_score
  FROM payor_resolution_decisions
  WHERE policy_version = ?
`).get(policyVersion);

const report = {
  generated_at: new Date().toISOString(),
  event: 'payor_resolution_decisions_run_completed',
  policy_profile: policyProfile,
  ...out,
  decision_totals_for_policy: {
    total: Number(agg?.total || 0),
    auto_merge: Number(agg?.auto_merge_count || 0),
    merge_review_flag: Number(agg?.merge_review_count || 0),
    review_candidate: Number(agg?.review_count || 0),
    distinct: Number(agg?.distinct_count || 0)
  },
  avg_final_score: Number((agg?.avg_score || 0).toFixed(6))
};

const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-resolution-decisions-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Resolution decision report written: ${outPath}`);
console.log(JSON.stringify(report, null, 2));

