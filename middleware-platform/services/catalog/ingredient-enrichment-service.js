'use strict';

const db = require('../../database');

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getEnrichedIngredients(productId) {
  try {
    return db.db.prepare(`
      SELECT
        pi.ingredient_order AS position,
        pi.raw_ingredient AS raw_text,
        pi.confidence,
        pi.match_method,
        pi.inci_name,
        pi.enrichment_version,
        pi.safety_flags_json,
        ci.functions_json AS role_json,
        ci.is_allergen,
        ci.allergen_type,
        ci.is_endocrine_dis,
        ci.is_eu_restricted,
        ci.restrictions_json
      FROM product_ingredients pi
      LEFT JOIN cosing_ingredients ci ON LOWER(TRIM(ci.inci_name)) = LOWER(TRIM(pi.inci_name))
      WHERE pi.product_id = ?
      ORDER BY pi.ingredient_order ASC
    `).all(String(productId || '').trim()).map((r) => ({
      ...r,
      role: parseJsonArray(r.role_json),
      safety_flags: parseJsonArray(r.safety_flags_json),
      restrictions: parseJsonObject(r.restrictions_json)
    }));
  } catch (_) {
    return [];
  }
}

function deriveIngredientSummary(enriched) {
  const rows = Array.isArray(enriched) ? enriched : [];
  const flagged = rows.filter((i) =>
    Number(i.is_allergen) === 1 ||
    Number(i.is_endocrine_dis) === 1 ||
    Number(i.is_eu_restricted) === 1
  );
  const unresolved = rows.filter((i) => String(i.match_method || '') === 'unresolved').length;
  return {
    total_ingredients: rows.length,
    resolved_count: rows.length - unresolved,
    confidence_distribution: {
      high: rows.filter((r) => Number(r.confidence) >= 0.9).length,
      medium: rows.filter((r) => Number(r.confidence) >= 0.65 && Number(r.confidence) < 0.9).length,
      low_or_unresolved: rows.filter((r) => Number(r.confidence) < 0.65 || !Number.isFinite(Number(r.confidence))).length
    },
    has_fragrance_allergens: rows.some((i) => String(i.allergen_type || '').toLowerCase() === 'fragrance'),
    flagged_ingredients: flagged.map((i) => ({
      name: i.inci_name || i.raw_text,
      position: i.position,
      reason: String(i.allergen_type || (Number(i.is_eu_restricted) === 1 ? 'eu_restricted' : 'safety_flag'))
    }))
  };
}

module.exports = {
  getEnrichedIngredients,
  deriveIngredientSummary
};
