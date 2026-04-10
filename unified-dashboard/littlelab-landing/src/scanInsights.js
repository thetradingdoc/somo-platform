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
  return [
    `[Pinned Product Context] ${p.product_name || scanResult?.barcode || 'unknown'} (${scanResult?.barcode || 'unknown'})`,
    p.ingredients_text ? `Ingredients: ${String(p.ingredients_text).slice(0, 900)}` : '',
    `Category Route: ${scanResult?.categoryRoute || 'unknown'}`,
    `Provenance: ${scanResult?.dataSource || 'unknown'}`
  ].filter(Boolean).join('\n');
}

export function buildFollowupMessageWithPinnedContext(userMessage, scanResult, isPinnedReady) {
  const msg = String(userMessage || '').trim();
  if (!isPinnedReady || !scanResult?.product || !scanResult?.barcode) return msg;
  return `${msg}\n\n${buildPinnedContextText(scanResult)}`.trim();
}

