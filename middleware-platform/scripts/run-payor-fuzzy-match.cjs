#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { runFuzzyScoring } = require('../services/payor-fuzzy-match-service');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const batchId = getArg('batch-id', null);
const scorerVersion = getArg('version', 'v1');
const limit = Number(getArg('limit', '50000')) || 50000;
const offset = Number(getArg('offset', '0')) || 0;

const out = runFuzzyScoring({
  batchId,
  scorerVersion,
  limit,
  offset
});

const agg = db.db.prepare(`
  SELECT
    COUNT(*) AS scored_candidates,
    AVG(jaro_winkler) AS avg_jaro_winkler,
    AVG(token_sort_ratio) AS avg_token_sort_ratio,
    AVG(token_set_ratio) AS avg_token_set_ratio
  FROM payor_similarity_scores
  WHERE scorer_version = ?
`).get(scorerVersion);

const report = {
  generated_at: new Date().toISOString(),
  event: 'payor_fuzzy_match_run_completed',
  ...out,
  scored_candidates_total_for_version: Number(agg?.scored_candidates || 0),
  avg_scores: {
    jaro_winkler: Number((agg?.avg_jaro_winkler || 0).toFixed(6)),
    token_sort_ratio: Number((agg?.avg_token_sort_ratio || 0).toFixed(6)),
    token_set_ratio: Number((agg?.avg_token_set_ratio || 0).toFixed(6))
  }
};

const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-fuzzy-match-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Fuzzy match report written: ${outPath}`);
console.log(JSON.stringify(report, null, 2));

