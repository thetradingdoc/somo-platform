#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const policyVersion = getArg('policy-version', null);
const limit = Math.max(1, Math.min(Number(getArg('limit', '5000')) || 5000, 20000));
const syncQueue = hasFlag('sync-queue');

let queueInserted = 0;
if (syncQueue) {
  queueInserted = db.enqueuePayorReviewQueueFromDecisions({
    policyVersion,
    decisions: ['merge_review_flag', 'review_candidate'],
    limit
  });
}

const promoted = db.promotePayorReviewedOutcomesToFeedback({ policyVersion, limit });
const metrics = db.getPayorFeedbackMetrics({ policyVersion });

const byAction = db.db.prepare(`
  SELECT reviewer_action, COUNT(*) AS count
  FROM payor_review_feedback_outcomes
  ${policyVersion ? 'WHERE policy_version = ?' : ''}
  GROUP BY reviewer_action
  ORDER BY count DESC
`).all(...(policyVersion ? [policyVersion] : []));

const byReviewer = db.db.prepare(`
  SELECT reviewer, COUNT(*) AS count
  FROM payor_review_feedback_outcomes
  ${policyVersion ? 'WHERE policy_version = ?' : ''}
  GROUP BY reviewer
  ORDER BY count DESC
  LIMIT 20
`).all(...(policyVersion ? [policyVersion] : []));

const report = {
  generated_at: new Date().toISOString(),
  event: 'payor_review_feedback_loop_completed',
  policy_version: policyVersion,
  queue_rows_inserted: queueInserted,
  outcomes_promoted: promoted,
  metrics: {
    total_reviews: Number(metrics?.total_reviews || 0),
    agreement_count: Number(metrics?.agreement_count || 0),
    override_count: Number(metrics?.override_count || 0),
    agreement_rate: Number(metrics?.agreement_rate || 0),
    override_rate: Number(metrics?.override_rate || 0)
  },
  by_action: byAction,
  by_reviewer: byReviewer
};

const outPath = path.join(process.cwd(), 'test-results/readiness-artifacts/payor-review-feedback-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Payor review feedback report written: ${outPath}`);
console.log(JSON.stringify(report, null, 2));

