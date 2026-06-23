'use strict';

function buildScanQuality(p = {}) {
  const hasName = !!String(p.product_name || '').trim();
  const hasIngredients = !!String(p.ingredients_text || '').trim();
  const hasCategories = Array.isArray(p.categories_tags) && p.categories_tags.length > 0;
  const hasImage = !!String(p.image_url || '').trim();
  const missing = [];
  if (!hasName) missing.push('name');
  if (!hasIngredients) missing.push('ingredients');
  if (!hasCategories) missing.push('categories');
  if (!hasImage) missing.push('image');
  if (hasName && hasIngredients && hasCategories) {
    return { tier: 'full', analyze_enabled: true, analyze_label: 'Analyze for my skin', missing };
  }
  if (hasName && (hasIngredients || hasCategories)) {
    return {
      tier: 'partial',
      analyze_enabled: hasIngredients,
      analyze_label: hasIngredients ? 'Analyze with partial profile' : 'Add ingredients to analyze',
      missing
    };
  }
  return { tier: 'insufficient', analyze_enabled: false, analyze_label: 'Add ingredients to analyze', missing };
}

function deriveIngredientFlags(p = {}) {
  const analysis = Array.isArray(p.ingredients_analysis_tags)
    ? p.ingredients_analysis_tags.map((x) => String(x || '').toLowerCase())
    : [];
  const txt = String(p.ingredients_text || '').toLowerCase();
  return {
    has_ingredients: !!txt.trim(),
    has_fragrance: /\bfragrance|parfum|perfume\b/.test(txt),
    has_palm_oil: analysis.some((t) => t.includes('palm-oil') || t.includes('palm_oil')) || /\bpalm\b/.test(txt)
  };
}

function buildCategoryRoutePayload(categoryEval = {}) {
  const categoryRouteOut = categoryEval.active || {};
  return {
    category_route: categoryRouteOut.route,
    category_route_source: categoryRouteOut.source,
    category_route_confidence: categoryRouteOut.confidence_band,
    category_route_rule_id: categoryRouteOut.rule_id,
    category_route_fallback: categoryRouteOut.fallback_text,
    category_route_map_version: categoryRouteOut.map_version,
    category_route_rollout_mode: categoryEval.rollout_mode,
    category_route_canary_applied: categoryEval.canary_applied,
    category_route_shadow:
      categoryEval.shadow
        ? {
            route: categoryEval.shadow.route,
            source: categoryEval.shadow.source,
            confidence: categoryEval.shadow.confidence_band,
            rule_id: categoryEval.shadow.rule_id,
            map_version: categoryEval.shadow.map_version
          }
        : undefined
  };
}

module.exports = {
  buildScanQuality,
  deriveIngredientFlags,
  buildCategoryRoutePayload
};
