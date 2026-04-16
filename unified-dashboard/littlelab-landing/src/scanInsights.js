function normList(input) {
  return Array.isArray(input) ? input.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean) : [];
}

export function deriveCategoryRoute(categoriesTags) {
  const tags = normList(categoriesTags);
  if (tags.some((t) => t.includes('cosmetic'))) return 'cosmetic';
  if (tags.some((t) => t.includes('hygiene'))) return 'hygiene';
  if (tags.some((t) => t.includes('non-food') || t.includes('non_food'))) return 'non_food';
  return 'unknown';
}

const SERVER_CATEGORY_ROUTES = new Set([
  'cosmetic',
  'hygiene',
  'non_food',
  'food',
  'supplement',
  'unknown'
]);

/**
 * Server-provided category route is authoritative when it is a valid enum value.
 * Fall back to client derivation only when the value is absent/invalid.
 */
export function resolveServerCategoryRoute(serverRoute) {
  const v = String(serverRoute || '').trim().toLowerCase();
  if (SERVER_CATEGORY_ROUTES.has(v)) {
    return { route: v, usedFallback: false };
  }
  return { route: null, usedFallback: true };
}

export function deriveIngredientFlags(product = {}) {
  const analysis = normList(product.ingredients_analysis_tags);
  const text = String(product.ingredients_text || '').toLowerCase();
  return {
    hasIngredients: !!text.trim(),
    hasPalmOil: analysis.some((t) => t.includes('palm-oil') || t.includes('palm_oil')) || /\bpalm\b/.test(text),
    hasSweeteners: analysis.some((t) => t.includes('sweetener')) || /\bsucralose|aspartame|saccharin\b/.test(text),
    hasFragrance: /\bfragrance|parfum|perfume\b/.test(text)
  };
}

export function isSparseProductData(product = {}) {
  const hasIngredients = !!String(product.ingredients_text || '').trim();
  const hasCategories = Array.isArray(product.categories_tags) && product.categories_tags.length > 0;
  return !hasIngredients || !hasCategories;
}

/** Match middleware `catalog-image-url.js` — OFF/OBF may only set non-`image_url` fields. */
const PRODUCT_IMAGE_URL_KEYS = [
  'image_url',
  'image_front_url',
  'image_front_small_url',
  'image_small_url',
  'image_ingredients_url',
  'image_nutrition_url',
  'image_packaging_url',
  'image_ingredients_small_url',
  'image_nutrition_small_url',
  'image_packaging_small_url'
];

export function pickFirstProductImageUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of PRODUCT_IMAGE_URL_KEYS) {
    const s = String(obj[k] ?? '').trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return null;
}

/**
 * JSON-serializable OBF fields for `product_data` on thread events and snapshot `scanned_product`.
 * Keeps arrays bounded for storage and transport.
 */
/** Thread + snapshot payload when the barcode is valid but no catalog has a product. `facts_source` `both` = tried OBF then OFF. */
export function serializeBarcodeNotFoundForThread(barcode, dataSource = null, catalogHint = 'both') {
  const facts_source =
    catalogHint === 'off'
      ? 'open_food_facts'
      : catalogHint === 'obf'
        ? 'open_beauty_facts'
        : 'both';
  return {
    barcode: barcode != null ? String(barcode).trim() : null,
    lookup_status: 'not_found',
    data_source: dataSource || null,
    facts_source
  };
}

export function serializeObfProductForThread(product = {}, dataSource = null, options = {}) {
  const img = pickFirstProductImageUrl(product) || '';
  const src = String(product.source || '').trim();
  const facts_source =
    src === 'open_food_facts' || src === 'open_beauty_facts' ? src : 'open_beauty_facts';
  return {
    barcode: product.barcode != null ? String(product.barcode).trim() : null,
    product_name: product.product_name != null ? String(product.product_name).trim() : null,
    image_url: img || null,
    ingredients_text: product.ingredients_text != null ? String(product.ingredients_text) : null,
    labels: Array.isArray(product.labels)
      ? product.labels.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    allergens: Array.isArray(product.allergens)
      ? product.allergens.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    categories_tags: Array.isArray(product.categories_tags)
      ? product.categories_tags.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    category_route: options.categoryRoute || null,
    category_route_source: options.categoryRouteSource || null,
    category_route_confidence: options.categoryRouteConfidence || null,
    category_route_rule_id: options.categoryRouteRuleId || null,
    category_route_fallback: options.categoryRouteFallback || null,
    scan_summary: options.scanSummary || null,
    data_source: dataSource || null,
    facts_source
  };
}

export function compareProducts(a = {}, b = {}) {
  const split = (s) => String(s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const ai = new Set(split(a.ingredients_text));
  const bi = new Set(split(b.ingredients_text));
  const overlap = [...ai].filter((x) => bi.has(x));
  return {
    overlapCount: overlap.length,
    onlyA: [...ai].filter((x) => !bi.has(x)).slice(0, 6),
    onlyB: [...bi].filter((x) => !ai.has(x)).slice(0, 6)
  };
}

export function buildPinnedContextText(scanResult = {}) {
  const p = scanResult?.product || {};
  const rc = scanResult?.resolvedCatalog;
  const matched =
    rc === 'off'
      ? 'Open Food Facts'
      : rc === 'obf'
        ? 'Open Beauty Facts'
        : '';
  return [
    `[Pinned Product Context] ${p.product_name || scanResult?.barcode || 'unknown'} (${scanResult?.barcode || 'unknown'})`,
    matched ? `Matched in: ${matched} (auto-detected)` : '',
    p.ingredients_text ? `Ingredients: ${String(p.ingredients_text).slice(0, 900)}` : '',
    `Category Route: ${scanResult?.categoryRoute || 'unknown'}`,
    `Provenance: ${scanResult?.dataSource || 'unknown'}`,
    `Skin & care: Explain how these ingredients may relate to skin (topical or diet-linked). Call out likely irritants or helpful actives for this user; not medical advice.`
  ].filter(Boolean).join('\n');
}

export function buildFollowupMessageWithPinnedContext(userMessage, scanResult, isPinnedReady) {
  const msg = String(userMessage || '').trim();
  if (!isPinnedReady || !scanResult?.product || !scanResult?.barcode) return msg;
  return `${msg}\n\n${buildPinnedContextText(scanResult)}`.trim();
}

