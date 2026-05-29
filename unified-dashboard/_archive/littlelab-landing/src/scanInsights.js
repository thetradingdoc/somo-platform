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

export function deriveIngredientFlags(product = {}, categoryRoute = null) {
  const analysis = normList(product.ingredients_analysis_tags);
  const text = String(product.ingredients_text || '').toLowerCase();
  const route = String(
    categoryRoute != null && String(categoryRoute).trim() !== ''
      ? categoryRoute
      : (product.category_route || '')
  ).toLowerCase().trim();
  const cosmeticSignalApplicable = route === '' || route === 'unknown' || route === 'cosmetic' || route === 'hygiene';
  return {
    hasIngredients: !!text.trim(),
    hasPalmOil:
      cosmeticSignalApplicable &&
      (analysis.some((t) => t.includes('palm-oil') || t.includes('palm_oil')) || /\bpalm\b/.test(text)),
    hasSweeteners: analysis.some((t) => t.includes('sweetener')) || /\bsucralose|aspartame|saccharin\b/.test(text),
    hasFragrance: cosmeticSignalApplicable && /\bfragrance|parfum|perfume\b/.test(text),
    applicableRoute: cosmeticSignalApplicable ? 'cosmetic_or_unknown' : 'non_cosmetic'
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

function normalizeProductImageUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  return null;
}

export function pickFirstProductImageUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of PRODUCT_IMAGE_URL_KEYS) {
    const u = normalizeProductImageUrl(obj[k]);
    if (u) return u;
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
    generic_name:
      product.generic_name != null && String(product.generic_name).trim()
        ? String(product.generic_name).trim()
        : null,
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

/** Prefer merged model reasoning in chat when the latest session snapshot is complete with model output. */
export function shouldAttachMergedReasoningContext(sessionResultSnapshot = null, scanResult = null) {
  if (!sessionResultSnapshot || typeof sessionResultSnapshot !== 'object') return false;
  const st = String(sessionResultSnapshot.reasoning_state || '').trim().toLowerCase();
  const mode = String(sessionResultSnapshot?.result_summary?.reasoning?.reasoning_mode || '').toLowerCase();
  const status = String(sessionResultSnapshot?.result_summary?.reasoning?.status || '').toLowerCase();
  const applied = status === 'applied';
  const stateOk = st === 'complete' || (!st && applied);
  if (!stateOk || mode !== 'model' || !applied) return false;
  const pinBc = String(scanResult?.barcode || '').trim();
  const snapBc = String(sessionResultSnapshot?.scanned_product?.barcode || '').trim();
  if (pinBc && snapBc && pinBc !== snapBc) return false;
  return true;
}

export function buildMergedReasoningContextBlock(sessionResultSnapshot = {}) {
  const v = sessionResultSnapshot?.result_summary?.verdict || {};
  const lines = [];
  const gfm = String(v?.good_for_me?.summary || '').trim();
  if (gfm) lines.push(`Good-for-me (merged scan): ${gfm.slice(0, 360)}`);
  const harm = String(v?.harmful?.summary || v?.harmful?.top_evidence || '').trim();
  if (harm) lines.push(`Risk note (merged scan): ${harm.slice(0, 280)}`);
  if (!lines.length) {
    lines.push('Merged scan summary: model reasoning is applied; use verdict fields in the latest snapshot for detail.');
  }
  return lines.join('\n');
}

export function buildPinnedContextText(scanResult = {}, sessionResultSnapshot = null) {
  const p = scanResult?.product || {};
  const rc = scanResult?.resolvedCatalog;
  const route = String(scanResult?.categoryRoute || '').toLowerCase();
  const matched =
    rc === 'off'
      ? 'Open Food Facts'
      : rc === 'obf'
        ? 'Open Beauty Facts'
        : '';
  const routeScopedAsk =
    route === 'food' || route === 'supplement'
      ? 'Diet context: summarize ingredient-level safety and nutrition-relevant cautions for this category. Not medical advice.'
      : route === 'non_food'
        ? 'General product context: summarize ingredient-level cautions and compatibility notes without skincare-only framing.'
        : 'Somo: explain ingredient-level fit, likely irritants, and helpful actives for this user; not medical advice.';
  const base = [
    `[Pinned Product Context] ${p.product_name || scanResult?.barcode || 'unknown'} (${scanResult?.barcode || 'unknown'})`,
    matched ? `Matched in: ${matched} (auto-detected)` : '',
    p.ingredients_text ? `Ingredients: ${String(p.ingredients_text).slice(0, 900)}` : '',
    `Category Route: ${scanResult?.categoryRoute || 'unknown'}`,
    `Provenance: ${scanResult?.dataSource || 'unknown'}`,
    routeScopedAsk
  ].filter(Boolean);
  if (shouldAttachMergedReasoningContext(sessionResultSnapshot, scanResult)) {
    base.push(buildMergedReasoningContextBlock(sessionResultSnapshot));
  } else if (sessionResultSnapshot && typeof sessionResultSnapshot === 'object') {
    const rs = String(sessionResultSnapshot.reasoning_state || '').trim().toLowerCase();
    if (rs === 'pending') {
      base.push(
        '[Scan summary note] AI-assisted reasoning is still finishing for this session; rely on the deterministic verdict lines above until the results page refreshes.'
      );
    } else if (rs === 'fallback') {
      base.push(
        '[Scan summary note] AI-assisted reasoning used a safe fallback for this session; rely on catalogue-backed verdict lines above.'
      );
    }
  }
  return base.join('\n');
}

export function buildFollowupMessageWithPinnedContext(userMessage, scanResult, isPinnedReady, sessionResultSnapshot = null) {
  const msg = String(userMessage || '').trim();
  if (!isPinnedReady || !scanResult?.product || !scanResult?.barcode) return msg;
  return `${msg}\n\n${buildPinnedContextText(scanResult, sessionResultSnapshot)}`.trim();
}

