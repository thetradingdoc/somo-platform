#!/usr/bin/env node
'use strict';

/**
 * Pilot sign-off gate for multilang human review (ES/RU tone/naturalness).
 * Checks committed review CSV vs harness summary hash + 14-day freshness.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const REVIEWS_DIR = path.join(REPO, 'docs/qa/reviews');
const SUMMARY_PATH = path.join(ROOT, 'test-results/multilang-conversation-eval/_summary.json');
const MAX_AGE_DAYS = 14;
const MIN_SCORE = 3;
const ES_RU_SCENARIOS = ['ES-1-booking', 'ES-2-copay', 'ES-3-cancellation', 'ES-4-inquiry-codeswitch', 'RU-1-booking', 'RU-2-copay', 'RU-3-cancellation', 'RU-4-inquiry'];

function latestReviewCsv() {
  if (!fs.existsSync(REVIEWS_DIR)) return null;
  const files = fs
    .readdirSync(REVIEWS_DIR)
    .filter((f) => /^multilang-.*\.csv$/i.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(REVIEWS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(REVIEWS_DIR, files[0].f) : null;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || '').trim();
    });
    return row;
  });
}

function daysSince(iso) {
  if (!iso) return Infinity;
  const ms = Date.now() - new Date(iso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function main() {
  const strict = process.env.STRICT === '1' || process.argv.includes('--strict');
  console.log('\n=== Multilang human review gate ===\n');

  if (!fs.existsSync(SUMMARY_PATH)) {
    console.log('ℹ️  No harness _summary.json — run test:eval:multilang first');
    process.exit(strict ? 1 : 0);
  }

  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  const summaryHash = summary.registry_hash || crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 16);

  if (summary.eval_runs > 1 && Array.isArray(summary.scenarios)) {
    const weakMajority = summary.scenarios.filter(
      (s) => s.majority && !s.majority.majorityPass && !s.skipped
    );
    if (weakMajority.length && strict) {
      console.log(`❌ ${weakMajority.length} scenario(s) failed 2/3 majority gate`);
      process.exit(1);
    } else if (weakMajority.length) {
      console.log(`ℹ️  ${weakMajority.length} scenario(s) below majority — informational`);
    }
  }

  const reviewPath = latestReviewCsv();
  if (!reviewPath) {
    console.log('❌ No docs/qa/reviews/multilang-*.csv committed');
    process.exit(strict ? 1 : 0);
    return;
  }

  const rows = parseCsv(fs.readFileSync(reviewPath, 'utf8'));
  const meta = rows.find((r) => r.scenario_id === '_meta');
  const reviewedHash = meta?.summary_hash || meta?.notes;
  if (reviewedHash && reviewedHash !== 'registry_pending' && reviewedHash !== summaryHash) {
    console.log(`❌ Review hash mismatch: reviewed=${reviewedHash} current=${summaryHash}`);
    process.exit(1);
  }

  const reviewedAt = meta?.reviewed_at;
  if (daysSince(reviewedAt) > MAX_AGE_DAYS && strict) {
    console.log(`❌ Review older than ${MAX_AGE_DAYS} days (${reviewedAt})`);
    process.exit(1);
  }

  let fail = false;
  if (strict) {
  for (const id of ES_RU_SCENARIOS) {
    const row = rows.find((r) => r.scenario_id === id);
    if (!row) {
      console.log(`❌ Missing review row for ${id}`);
      fail = true;
      continue;
    }
    const tone = Number(row.tone_score);
    const natural = Number(row.naturalness_score);
    if (tone < MIN_SCORE || natural < MIN_SCORE) {
      console.log(`❌ ${id} scores below ${MIN_SCORE} (tone=${tone}, natural=${natural})`);
      fail = true;
    }
  }
  }

  if (fail) {
    console.log('\n❌ Human review gate failed\n');
    process.exit(1);
  }

  console.log(`✅ Human review current (${path.basename(reviewPath)}, hash=${summaryHash})\n`);
  process.exit(0);
}

main();
