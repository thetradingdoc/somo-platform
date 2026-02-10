/**
 * Search Intent Builder - Layer 2 RAG
 *
 * Builds high-precision search queries from perceptual state (Layer 1 output).
 * Replaces raw clinicalNote search with structured findings-based query.
 */

/**
 * Build search query from perceptual state
 * @param {object} perceptualState - Layer 1 output { visual_findings, textual_findings, cross_modal_links, specialty_tag }
 * @param {string} fallbackText - Raw clinical text when no perceptual state
 * @returns {{ query: string, specialty: string, filters: object }}
 */
function buildSearchIntent(perceptualState, fallbackText = '') {
  if (!perceptualState || (typeof perceptualState !== 'object')) {
    return {
      query: (fallbackText || '').toString().trim().slice(0, 500),
      specialty: 'general',
      filters: {},
      source: 'fallback'
    };
  }

  const {
    visual_findings = [],
    textual_findings = [],
    cross_modal_links = [],
    specialty_tag = 'general',
    expanded_text = ''
  } = perceptualState;

  const parts = [];

  // Visual findings (highest weight - from imaging)
  for (const v of visual_findings) {
    if (v.finding) parts.push(String(v.finding).replace(/_/g, ' '));
    if (v.body_region) parts.push(String(v.body_region).replace(/_/g, ' '));
    if (v.laterality) parts.push(v.laterality);
  }

  // Textual findings
  for (const t of textual_findings) {
    const mention = t.mention || t.concept;
    if (mention) parts.push(String(mention).replace(/_/g, ' '));
  }

  // Cross-modal links (strong alignment)
  for (const link of cross_modal_links) {
    if (link.alignment_score > 0.7) {
      if (link.visual_finding) parts.push(String(link.visual_finding).replace(/_/g, ' '));
      if (link.text_concept) parts.push(String(link.text_concept).replace(/_/g, ' '));
    }
  }

  const query = [...new Set(parts)].filter(Boolean).join(' ').trim();
  const hasQuery = query.length > 0;

  // Filters from perceptual state
  const visualLat = visual_findings.find(f => f.laterality)?.laterality;
  const textLat = textual_findings.find(f => f.laterality)?.laterality;
  const laterality = visualLat || textLat || null;

  return {
    query: hasQuery ? query : (expanded_text || fallbackText || '').toString().trim().slice(0, 500),
    specialty: specialty_tag || 'general',
    filters: {
      laterality,
      has_visual: visual_findings.length > 0,
      has_cross_modal: cross_modal_links.length > 0
    },
    source: hasQuery ? 'perceptual' : 'fallback'
  };
}

/**
 * Build a query string suitable for getCodeCandidates
 * Used when perceptual state is available - extracts findings instead of raw note
 */
function buildSearchQuery(perceptualState, fallbackText = '') {
  const intent = buildSearchIntent(perceptualState, fallbackText);
  return intent.query;
}

module.exports = {
  buildSearchIntent,
  buildSearchQuery
};
