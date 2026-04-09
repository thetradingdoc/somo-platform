'use strict';

const OBF_BASE = (process.env.OPEN_BEAUTY_FACTS_BASE_URL || 'https://world.openbeautyfacts.org').replace(/\/$/, '');
const UA = process.env.OPEN_BEAUTY_FACTS_USER_AGENT || 'doclittle-platform/1.0 (integration; support@doclittle.com)';

function normalizeBarcode(barcode) {
  return String(barcode || '').replace(/[^\d]/g, '');
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** OBF tags / hierarchy fields: arrays in JSON, or comma-separated strings in some exports. */
function toTagList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  return toList(value);
}

function normalizeIngredientsArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 80)
    .map((i) => {
      const id = i?.id != null ? String(i.id).trim() : '';
      const text = i?.text != null ? String(i.text).trim() : '';
      const pe = i?.percent_estimate != null ? Number(i.percent_estimate) : null;
      if (!id && !text) return null;
      const o = {};
      if (id) o.id = id;
      if (text) o.text = text;
      else if (id) o.text = id;
      if (pe != null && !Number.isNaN(pe)) o.percent_estimate = pe;
      return o;
    })
    .filter(Boolean);
}

function normalizeProduct(payload = {}) {
  const p = payload.product || {};
  return {
    source: 'open_beauty_facts',
    barcode: String(payload.code || p.code || ''),
    found: Number(payload.status || 0) === 1,
    product_name: p.product_name || p.product_name_en || p.product_name_fr || null,
    brands: toList(p.brands),
    ingredients_text: p.ingredients_text_with_allergens || p.ingredients_text_en || p.ingredients_text || null,
    ingredients: normalizeIngredientsArray(p.ingredients),
    allergens: toList(p.allergens),
    labels: toList(p.labels),
    categories: toList(p.categories),
    categories_tags: toTagList(p.categories_tags),
    categories_hierarchy: toTagList(p.categories_hierarchy),
    ingredients_analysis_tags: toTagList(p.ingredients_analysis_tags),
    states_tags: toTagList(p.states_tags),
    // Upstream field; not a documented fixed enum in official API docs — pass through only, do not branch on assumed values.
    product_type: p.product_type != null && p.product_type !== '' ? String(p.product_type) : null,
    image_url: p.image_front_url || p.image_url || null,
    product_url: p.url || null
  };
}

async function fetchBeautyFactsByBarcode(barcode) {
  const clean = normalizeBarcode(barcode);
  if (!/^\d{8,14}$/.test(clean)) {
    return { success: false, error: 'invalid_barcode', normalized: null };
  }
  const url = `${OBF_BASE}/api/v2/product/${clean}`;
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': UA
    }
  });
  if (!r.ok) {
    return { success: false, error: `upstream_${r.status}`, normalized: null };
  }
  const data = await r.json().catch(() => null);
  if (!data) return { success: false, error: 'invalid_upstream_json', normalized: null };
  return { success: true, normalized: normalizeProduct(data), raw: data };
}

module.exports = {
  fetchBeautyFactsByBarcode,
  normalizeBarcode,
  normalizeProduct
};
