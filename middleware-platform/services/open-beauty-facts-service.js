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

function normalizeProduct(payload = {}) {
  const p = payload.product || {};
  return {
    source: 'open_beauty_facts',
    barcode: String(payload.code || p.code || ''),
    found: Number(payload.status || 0) === 1,
    product_name: p.product_name || p.product_name_en || p.product_name_fr || null,
    brands: toList(p.brands),
    ingredients_text: p.ingredients_text_with_allergens || p.ingredients_text_en || p.ingredients_text || null,
    ingredients: Array.isArray(p.ingredients)
      ? p.ingredients
          .map((i) => String(i?.text || i?.id || '').trim())
          .filter(Boolean)
          .slice(0, 80)
      : [],
    allergens: toList(p.allergens),
    labels: toList(p.labels),
    categories: toList(p.categories),
    image_url: p.image_front_url || p.image_url || null,
    product_url: p.url || null
  };
}

async function fetchBeautyFactsByBarcode(barcode) {
  const clean = normalizeBarcode(barcode);
  if (!/^\d{8,14}$/.test(clean)) {
    return { success: false, error: 'invalid_barcode', normalized: null };
  }
  const url = `${OBF_BASE}/api/v2/product/${clean}.json`;
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
  normalizeBarcode
};

