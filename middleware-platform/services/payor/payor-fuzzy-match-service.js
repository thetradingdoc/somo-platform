'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function ratio(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const maxLen = Math.max(s.length, t.length);
  if (!maxLen) return 1;
  return 1 - (levenshtein(s, t) / maxLen);
}

function jaroWinkler(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  const matchDistance = Math.floor(Math.max(s.length, t.length) / 2) - 1;
  const sMatches = new Array(s.length).fill(false);
  const tMatches = new Array(t.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, t.length);
    for (let j = start; j < end; j++) {
      if (tMatches[j]) continue;
      if (s[i] !== t[j]) continue;
      sMatches[i] = true;
      tMatches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < s.length; i++) {
    if (!sMatches[i]) continue;
    while (!tMatches[k]) k++;
    if (s[i] !== t[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const m = matches;
  const jaro = ((m / s.length) + (m / t.length) + ((m - transpositions) / m)) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s.length, t.length); i++) {
    if (s[i] === t[i]) prefix++;
    else break;
  }
  return jaro + (prefix * 0.1 * (1 - jaro));
}

function tokenSortRatio(a, b) {
  const sa = tokenize(a).sort().join(' ');
  const sb = tokenize(b).sort().join(' ');
  return ratio(sa, sb);
}

function tokenSetRatio(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size && !setB.size) return 1;
  const inter = new Set([...setA].filter((x) => setB.has(x)));
  const left = [...setA].filter((x) => !inter.has(x));
  const right = [...setB].filter((x) => !inter.has(x));
  const base = [...inter].join(' ');
  const compA = [base, ...left].filter(Boolean).join(' ').trim();
  const compB = [base, ...right].filter(Boolean).join(' ').trim();
  return Math.max(ratio(base, compA), ratio(base, compB), ratio(compA, compB));
}

function scoreNamePair(leftName, rightName) {
  return {
    jaro_winkler: Number(jaroWinkler(leftName, rightName).toFixed(6)),
    token_sort_ratio: Number(tokenSortRatio(leftName, rightName).toFixed(6)),
    token_set_ratio: Number(tokenSetRatio(leftName, rightName).toFixed(6))
  };
}

function runFuzzyScoring({ batchId = null, limit = 50000, offset = 0, scorerVersion = 'v1' } = {}) {
  const candidates = db.getPayorCandidatesForScoring({ batchId, limit, offset });
  const scores = candidates.map((c) => ({
    id: `payor_score_${uuidv4()}`,
    candidate_id: c.candidate_id,
    ...scoreNamePair(c.left_normalized_name, c.right_normalized_name),
    scorer_version: scorerVersion
  }));
  const upserted = db.upsertPayorSimilarityScores(scores);
  return {
    batch_id: batchId,
    scorer_version: scorerVersion,
    candidates_scanned: candidates.length,
    scores_upserted: upserted
  };
}

module.exports = {
  jaroWinkler,
  tokenSortRatio,
  tokenSetRatio,
  scoreNamePair,
  runFuzzyScoring
};

