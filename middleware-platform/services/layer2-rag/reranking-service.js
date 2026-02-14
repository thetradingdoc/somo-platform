/**
 * Reranking Service - Layer 2 RAG (Optional)
 *
 * Reranks code candidates by relevance to perceptual state / clinical context.
 * Uses perceptual-state-aware scoring: boosts codes whose descriptions align
 * with findings. No external cross-encoder API required.
 */

const { buildSearchIntent } = require('./search-intent-builder');

/**
 * Rerank code candidates by perceptual-state relevance.
 * Boosts codes whose description contains terms from visual/textual findings.
 *
 * @param {Array<{code, description, ...}>} candidates - Code candidates (any code type)
 * @param {object} perceptualState - Optional { visual_findings, textual_findings }
 * @param {string} fallbackQuery - Fallback text when no perceptual state
 * @param {number} topK - Return top K after reranking (default: same as input length)
 * @returns {Array<{code, description, ..., rerank_score?}>}
 */
function rerankByPerceptualRelevance(candidates, perceptualState, fallbackQuery = '', topK = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) return candidates;

  const intent = perceptualState ? buildSearchIntent(perceptualState, fallbackQuery) : null;
  const terms = new Set();
  if (intent?.query) {
    intent.query.toLowerCase().split(/\s+/).filter(w => w.length > 2).forEach(w => terms.add(w));
  }
  if (fallbackQuery && terms.size === 0) {
    fallbackQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2).forEach(w => terms.add(w));
  }
  if (terms.size === 0) return candidates;

  const scored = candidates.map(c => {
    const desc = ((c.description || '') + ' ' + (c.code || '')).toLowerCase();
    let boost = 0;
    for (const t of terms) {
      if (desc.includes(t)) boost += 0.15;
    }
    const baseScore = typeof c.semantic_score === 'number' ? c.semantic_score : (c.confidence ?? 0.5);
    const rerankScore = Math.min(1, baseScore + boost);
    return { ...c, rerank_score: Math.round(rerankScore * 1000) / 1000 };
  });

  return scored
    .sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0))
    .slice(0, topK ?? candidates.length);
}

module.exports = {
  rerankByPerceptualRelevance
};
