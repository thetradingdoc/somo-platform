/**
 * Phase 4.2 — Grounding: avoid answering from passages that don't match the question
 * (evidence mismatch / unrelated acne text).
 */

const STOP = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'can',
  'her',
  'was',
  'one',
  'our',
  'out',
  'has',
  'have',
  'been',
  'this',
  'that',
  'with',
  'from',
  'they',
  'will',
  'your',
  'what',
  'when',
  'how',
  'does',
  'did',
  'about',
  'into',
  'than',
  'then',
  'them',
  'very',
  'just',
  'only',
  'also',
  'some',
  'such',
  'there',
  'their',
  'would',
  'could',
  'should'
]);

function tokenizeMeaningful(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Overlap score: fraction of query tokens that appear in passage text.
 * @param {string} query
 * @param {string} passageText
 * @returns {number} 0..1
 */
function passageGroundingScore(query, passageText) {
  const qTokens = tokenizeMeaningful(query);
  if (qTokens.length === 0) return 0.5;
  const pTokens = new Set(tokenizeMeaningful(passageText));
  let hit = 0;
  for (const t of qTokens) {
    if (pTokens.has(t)) hit += 1;
  }
  return hit / qTokens.length;
}

/**
 * @param {object} opts
 * @param {string} opts.query - User question (message + optional caption context)
 * @param {Array<{ text?: string }>} opts.passages
 * @param {number} [opts.minBestScore] - Below this → evidence mismatch (default from env or 0.14)
 * @returns {{ best_score: number, best_index: number, should_abstain: boolean, scores: number[], reason: string|null }}
 */
function assessPassageGrounding(opts = {}) {
  const query = (opts.query || '').toString().trim();
  const passages = Array.isArray(opts.passages) ? opts.passages : [];
  const minBest =
    typeof opts.minBestScore === 'number'
      ? opts.minBestScore
      : parseFloat(process.env.DERM_QA_GROUNDING_MIN_SCORE || '0.14');

  if (passages.length === 0) {
    return {
      best_score: 0,
      best_index: -1,
      should_abstain: false,
      scores: [],
      reason: null
    };
  }

  const scores = passages.map((p, i) => {
    const text = (p && (p.text || p.passage)) || '';
    return passageGroundingScore(query, text);
  });
  let bestIndex = 0;
  let best = scores[0] ?? 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > best) {
      best = scores[i];
      bestIndex = i;
    }
  }

  const should_abstain = best < minBest;
  return {
    best_score: Math.round(best * 1000) / 1000,
    best_index: bestIndex,
    should_abstain,
    scores,
    reason: should_abstain ? 'evidence_mismatch' : null
  };
}

module.exports = {
  assessPassageGrounding,
  passageGroundingScore,
  tokenizeMeaningful
};
