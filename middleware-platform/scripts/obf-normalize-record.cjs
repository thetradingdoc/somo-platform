'use strict';

function toTagList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeObfDocument(raw = {}) {
  const p = raw.product && typeof raw.product === 'object' ? raw.product : raw;
  const code = String(raw.code || p.code || p._id || '').replace(/[^\d]/g, '').trim();
  if (!code) return null;
  return {
    code,
    product_name: p.product_name || p.product_name_en || p.product_name_fr || null,
    brands: p.brands || null,
    brands_tags: toTagList(p.brands_tags),
    categories_tags: toTagList(p.categories_tags),
    categories_hierarchy: toTagList(p.categories_hierarchy),
    ingredients_text: p.ingredients_text_with_allergens || p.ingredients_text_en || p.ingredients_text || null,
    ingredients_tags: toTagList(p.ingredients_tags),
    ingredients_analysis_tags: toTagList(p.ingredients_analysis_tags),
    states_tags: toTagList(p.states_tags),
    image_url: p.image_front_url || p.image_url || null,
    product_url: p.url || null,
    last_modified_t: Number(p.last_modified_t || raw.last_modified_t || 0) || null
  };
}

module.exports = { normalizeObfDocument };
