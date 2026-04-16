'use strict';

const OFF_BASE = (process.env.OPEN_FOOD_FACTS_BASE_URL || 'https://world.openfoodfacts.org').replace(/\/$/, '');
const UA = process.env.OPEN_FOOD_FACTS_USER_AGENT || 'doclittle-platform/1.0 (integration; support@doclittle.com)';
const OFF_TIMEOUT_MS = Number(process.env.OFF_HTTP_TIMEOUT_MS || 3500);
const OFF_MAX_RETRIES = Math.max(0, Number(process.env.OFF_HTTP_MAX_RETRIES || 1));
const db = require('../database');
const { pickFirstCatalogImageUrl } = require('./catalog-image-url');

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

/** When OFF omits `ingredients_text` (common for beverages), build a readable line from structured `ingredients`. */
function ingredientsTextFromStructuredIngredients(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const parts = [];
  for (const i of raw.slice(0, 120)) {
    const text = i?.text != null ? String(i.text).trim() : '';
    const id = i?.id != null ? String(i.id).trim() : '';
    const bit = text || (id ? id.replace(/^..:/, '').replace(/-/g, ' ') : '');
    if (bit) parts.push(bit);
  }
  const line = parts.join(', ').trim();
  if (!line) return null;
  return line.length > 4000 ? `${line.slice(0, 3997)}...` : line;
}

/** Fallback when index/cache row has no `ingredients_text` but has `ingredients_tags`. */
function ingredientsTextFromTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return null;
  const parts = tags
    .slice(0, 100)
    .map((t) =>
      String(t || '')
        .replace(/^[a-z]{2}:/i, '')
        .replace(/-/g, ' ')
        .trim()
    )
    .filter(Boolean);
  const line = parts.join(', ');
  return line.length > 4000 ? `${line.slice(0, 3997)}...` : line || null;
}

function normalizeProduct(payload = {}) {
  const p = payload.product || {};
  const rawFields =
    p.ingredients_text_with_allergens || p.ingredients_text_en || p.ingredients_text || null;
  const fromFields = String(rawFields || '').trim() || null;
  const fromStructured = fromFields ? null : ingredientsTextFromStructuredIngredients(p.ingredients);
  return {
    source: 'open_food_facts',
    barcode: String(payload.code || p.code || ''),
    found: Number(payload.status || 0) === 1,
    product_name: p.product_name || p.product_name_en || p.product_name_fr || null,
    brands: toList(p.brands),
    ingredients_text: fromFields || fromStructured || null,
    ingredients: normalizeIngredientsArray(p.ingredients),
    allergens: toList(p.allergens),
    labels: toList(p.labels),
    categories: toList(p.categories),
    categories_tags: toTagList(p.categories_tags),
    categories_hierarchy: toTagList(p.categories_hierarchy),
    ingredients_analysis_tags: toTagList(p.ingredients_analysis_tags),
    states_tags: toTagList(p.states_tags),
    product_type: p.product_type != null && p.product_type !== '' ? String(p.product_type) : null,
    image_url: pickFirstCatalogImageUrl(p) || null,
    product_url: p.url || null
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error('off_timeout')), Math.max(250, Number(timeoutMs) || OFF_TIMEOUT_MS));
  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': UA
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(id);
  }
}

async function fetchFoodFactsByBarcode(barcode) {
  const clean = normalizeBarcode(barcode);
  if (!/^\d{8,14}$/.test(clean)) {
    return { success: false, error: 'invalid_barcode', normalized: null };
  }
  const url = `${OFF_BASE}/api/v2/product/${clean}`;
  let lastErr = null;
  let r = null;
  for (let attempt = 0; attempt <= OFF_MAX_RETRIES; attempt++) {
    try {
      r = await fetchWithTimeout(url, OFF_TIMEOUT_MS);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!r) {
    if (String(lastErr?.name || '').includes('AbortError') || String(lastErr?.message || '').includes('off_timeout')) {
      return { success: false, error: 'upstream_timeout', normalized: null };
    }
    return { success: false, error: 'upstream_unreachable', normalized: null };
  }
  if (!r.ok) {
    return { success: false, error: `upstream_${r.status}`, normalized: null };
  }
  const data = await r.json().catch(() => null);
  if (!data) return { success: false, error: 'invalid_upstream_json', normalized: null };
  const normalized = normalizeProduct(data);
  try {
    db.upsertOffIndexProduct({
      code: normalized.barcode,
      product_name: normalized.product_name,
      brands: normalized.brands.join(', '),
      brands_tags: toTagList(data?.product?.brands_tags),
      categories_tags: normalized.categories_tags,
      categories_hierarchy: normalized.categories_hierarchy,
      ingredients_text: normalized.ingredients_text,
      ingredients_tags: toTagList(data?.product?.ingredients_tags),
      ingredients_analysis_tags: normalized.ingredients_analysis_tags,
      states_tags: normalized.states_tags,
      image_url: normalized.image_url,
      product_url: normalized.product_url,
      source: 'live_api',
      source_file: null,
      last_modified_t: Number(data?.product?.last_modified_t || 0) || null
    });
  } catch (_) {
    // best-effort index cache
  }
  return { success: true, normalized, raw: data };
}

module.exports = {
  fetchFoodFactsByBarcode,
  normalizeBarcode,
  normalizeProduct,
  ingredientsTextFromTags
};
