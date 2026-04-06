/**
 * Lexical reranking for patient-education passages (no external cross-encoder).
 * P4.5: optional SEO/spam filter + boost for guideline-tagged chunks.
 */

const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.resolve(__dirname, '../../../Knowledge/rules/derm-corpus-content-policy.json');

let policy = { seo_spam_substrings: [], seo_spam_regex: [] };
try {
  if (fs.existsSync(POLICY_PATH)) {
    policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  }
} catch (e) {
  console.warn('[patient-education-passage-rerank] Policy load failed:', e.message);
}

function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

function isLikelySeoSpam(text) {
  const t = (text || '').toLowerCase();
  for (const s of policy.seo_spam_substrings || []) {
    if (s && t.includes(String(s).toLowerCase())) return true;
  }
  for (const re of policy.seo_spam_regex || []) {
    try {
      if (new RegExp(re, 'i').test(t)) return true;
    } catch (_) {
      /* ignore invalid regex in config */
    }
  }
  return false;
}

function guidelineBoost(p) {
  const m = (p && p.metadata) || {};
  if (m.guideline === true || m.is_guideline === true) return 0.15;
  if (m.source_type === 'guideline') return 0.15;
  const tags = m.tags;
  if (Array.isArray(tags)) {
    for (const x of tags) {
      if (/guideline|aad|approved_brief/i.test(String(x))) return 0.12;
    }
  }
  return 0;
}

/**
 * Lexical overlap score for one passage. `overlap` counts token matches; each match adds 0.04
 * to the boost until the boost hits a hard cap of 0.35 (long passages cannot dominate via overlap alone).
 */
function scoreLexicalOverlap(passage, qTerms) {
  const text = (passage.text || passage.passage || '').toString();
  const pTerms = tokenize(text);
  let overlap = 0;
  for (const t of pTerms) {
    if (qTerms.has(t)) overlap += 1;
  }
  const base = typeof passage.score === 'number' ? passage.score : 0.5;
  const lexicalBoost = Math.min(0.35, overlap * 0.04);
  const combined = Math.min(1, base * 0.85 + lexicalBoost);
  return { rerank_score: Math.round(combined * 1000) / 1000, overlap };
}

/**
 * @param {Array<{ text?: string, score?: number }>} passages
 * @param {string} queryText
 * @param {number} [topK]
 * @returns {Array<object>}
 */
function rerankPassagesByLexicalOverlap(passages, queryText, topK = null) {
  if (!Array.isArray(passages) || passages.length === 0) return passages || [];
  const qTerms = new Set(tokenize(queryText));
  if (qTerms.size === 0) return topK != null ? passages.slice(0, topK) : passages;

  const scored = passages.map((p) => {
    const { rerank_score } = scoreLexicalOverlap(p, qTerms);
    return { ...p, rerank_score };
  });

  scored.sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0));
  return topK != null ? scored.slice(0, topK) : scored;
}

/**
 * Filter spam-like chunks, apply lexical + guideline boost.
 * @returns {{ passages: object[], dropped_spam: number, all_filtered_spam: boolean }}
 */
function rerankPassagesWithContentPolicy(passages, queryText, topK) {
  const raw = passages || [];
  const filtered = raw.filter((p) => {
    const text = (p.text || p.passage || '').toString();
    return !isLikelySeoSpam(text);
  });
  const dropped_spam = raw.length - filtered.length;
  if (filtered.length === 0) {
    return { passages: [], dropped_spam, all_filtered_spam: raw.length > 0 };
  }
  const qTerms = new Set(tokenize(queryText));
  const boosted = filtered.map((p) => {
    const { rerank_score: rs0 } = scoreLexicalOverlap(p, qTerms);
    const g = guidelineBoost(p);
    return { ...p, rerank_score: Math.min(1, rs0 + g), guideline_boost: g };
  });
  boosted.sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0));
  const final = topK != null ? boosted.slice(0, topK) : boosted;
  return { passages: final, dropped_spam, all_filtered_spam: false };
}

module.exports = {
  rerankPassagesByLexicalOverlap,
  rerankPassagesWithContentPolicy,
  isLikelySeoSpam,
  guidelineBoost,
  scoreLexicalOverlap
};
