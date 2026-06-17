#!/usr/bin/env node
/**
 * Offline ASR quality eval — WER, CER, SER on golden transcript pairs (S1–S3).
 * Usage: node scripts/speech-asr-eval.cjs [--file eval/speech-golden-set.json]
 */
'use strict';

const fs = require('fs');
const path = require('path');

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeWords(s) {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function wer(reference, hypothesis) {
  const ref = tokenizeWords(reference);
  const hyp = tokenizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / ref.length;
}

function cer(reference, hypothesis) {
  const ref = normalizeText(reference).replace(/\s/g, '');
  const hyp = normalizeText(hypothesis).replace(/\s/g, '');
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein(ref.split(''), hyp.split('')) / ref.length;
}

function main() {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  const rel = fileArg ? fileArg.slice('--file='.length) : 'eval/speech-golden-set.json';
  const filePath = path.join(__dirname, '..', rel);
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  let werSum = 0;
  let cerSum = 0;
  let sentenceErrors = 0;

  const results = rows.map((row) => {
    const w = wer(row.reference, row.hypothesis);
    const c = cer(row.reference, row.hypothesis);
    const hasError = w > 0;
    if (hasError) sentenceErrors += 1;
    werSum += w;
    cerSum += c;
    return { id: row.id, wer: w, cer: c, sentence_error: hasError };
  });

  const n = rows.length || 1;
  const summary = {
    samples: rows.length,
    wer_mean: werSum / n,
    cer_mean: cerSum / n,
    ser: sentenceErrors / n,
    wrr_mean: 1 - werSum / n,
    results
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.wer_mean > 0.15) {
    console.error(`❌ WER mean ${(summary.wer_mean * 100).toFixed(1)}% exceeds 15% gate`);
    process.exit(1);
  }
  console.log('✅ speech-asr-eval passed');
}

main();
