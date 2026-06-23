'use strict';

function uniq(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean))];
}

function tokenizeIngredients(ingredientsText = '') {
  return String(ingredientsText || '')
    .toLowerCase()
    .split(/[,\.;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function extractRouteAwareKeywords({ categoryRoute = 'unknown', ingredientsText = '', productName = '', userQueryText = '' } = {}) {
  const route = String(categoryRoute || 'unknown').toLowerCase();
  const tokens = tokenizeIngredients(ingredientsText);
  const nameTokens = String(productName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
    .slice(0, 6);
  const queryTokens = String(userQueryText || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
    .slice(0, 8);

  if (route === 'cosmetic' || route === 'hygiene') {
    return uniq([...tokens, ...nameTokens, ...queryTokens].filter((t) => !/\bserving|calories|nutrition\b/.test(t))).slice(0, 18);
  }
  if (route === 'food' || route === 'supplement') {
    return uniq([...tokens, ...nameTokens, ...queryTokens].filter((t) => !/\btone_evening|anti_aging|blemish|retinoid\b/.test(t))).slice(0, 18);
  }
  return uniq([...tokens, ...nameTokens].slice(0, 14));
}

function buildRouteSpecificRetrievalPlan({ categoryRoute = 'unknown' } = {}) {
  const route = String(categoryRoute || 'unknown').toLowerCase();
  if (route === 'cosmetic' || route === 'hygiene') {
    return {
      route,
      sources_by_field: {
        'verdict.good_for_me.summary': ['routine_conflict_graph', 'ingredient_semantic_index', 'session_profile'],
        'verdict.harmful.flags': ['ingredient_semantic_index', 'hazard_dictionary', 'nyc_metals_reference'],
        'verdict.harmful.top_evidence': ['ingredient_semantic_index', 'routine_conflict_graph'],
        'verdict.alternatives.candidates': ['catalog_similarity_index']
      }
    };
  }
  if (route === 'food' || route === 'supplement') {
    return {
      route,
      sources_by_field: {
        'verdict.good_for_me.summary': ['catalog_route_contract', 'ingredient_text_scan'],
        'verdict.harmful.flags': ['ingredient_text_scan', 'nyc_metals_reference'],
        'verdict.harmful.top_evidence': ['ingredient_text_scan'],
        'verdict.alternatives.candidates': ['route_policy_block']
      }
    };
  }
  return {
    route,
    sources_by_field: {
      'verdict.good_for_me.summary': ['catalog_route_contract'],
      'verdict.harmful.flags': ['ingredient_text_scan'],
      'verdict.harmful.top_evidence': ['ingredient_text_scan'],
      'verdict.alternatives.candidates': ['route_policy_block']
    }
  };
}

function buildClaimProvenance({ fieldPath, plan, keywords = [] }) {
  const sources = Array.isArray(plan?.sources_by_field?.[fieldPath]) ? plan.sources_by_field[fieldPath] : [];
  return sources.map((source, idx) => ({
    source,
    doc_id_ref: `${source}:${idx + 1}`,
    evidence_snippet_key: keywords[idx] || keywords[0] || 'route_contract'
  }));
}

function buildRouteAwareGrounding(input = {}) {
  const keywords = extractRouteAwareKeywords(input);
  const retrievalPlan = buildRouteSpecificRetrievalPlan(input);
  return {
    keywords,
    retrieval_plan: retrievalPlan
  };
}

module.exports = {
  extractRouteAwareKeywords,
  buildRouteSpecificRetrievalPlan,
  buildClaimProvenance,
  buildRouteAwareGrounding
};
