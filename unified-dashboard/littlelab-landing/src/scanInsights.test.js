/**
 * Unit tests for exported functions in scanInsights.js.
 * Run: npm test -- --testPathPattern="scanInsights"
 */

import {
  buildFollowupMessageWithPinnedContext,
  buildPinnedContextText,
  compareProducts,
  deriveCategoryRoute,
  deriveIngredientFlags,
  isSparseProductData,
  resolveServerCategoryRoute,
  serializeBarcodeNotFoundForThread,
  serializeObfProductForThread
} from './scanInsights';

describe('deriveCategoryRoute', () => {
  test('returns "cosmetic" when any tag contains "cosmetic"', () => {
    expect(deriveCategoryRoute(['en:cosmetics', 'en:face-care'])).toBe('cosmetic');
  });

  test('returns "hygiene" when any tag contains "hygiene"', () => {
    expect(deriveCategoryRoute(['en:hygiene'])).toBe('hygiene');
  });

  test('returns "non_food" for non-food tag (hyphen variant)', () => {
    expect(deriveCategoryRoute(['en:non-food-products', 'en:beauty'])).toBe('non_food');
  });

  test('returns "non_food" for non_food tag (underscore variant)', () => {
    expect(deriveCategoryRoute(['en:non_food'])).toBe('non_food');
  });

  test('returns "unknown" when no tags match', () => {
    expect(deriveCategoryRoute(['en:breakfast-cereals'])).toBe('unknown');
  });

  test('returns "unknown" for empty array', () => {
    expect(deriveCategoryRoute([])).toBe('unknown');
  });

  test('returns "unknown" for null / undefined input', () => {
    expect(deriveCategoryRoute(null)).toBe('unknown');
    expect(deriveCategoryRoute(undefined)).toBe('unknown');
  });

  test('tag matching is case-insensitive', () => {
    expect(deriveCategoryRoute(['EN:COSMETICS'])).toBe('cosmetic');
  });

  test('cosmetic takes priority over hygiene when both present', () => {
    expect(deriveCategoryRoute(['en:cosmetic-hygiene-products'])).toBe('cosmetic');
  });
});

describe('resolveServerCategoryRoute', () => {
  test('treats server unknown as authoritative', () => {
    expect(resolveServerCategoryRoute('unknown')).toEqual({ route: 'unknown', usedFallback: false });
  });

  test('accepts known enum values', () => {
    expect(resolveServerCategoryRoute('cosmetic')).toEqual({ route: 'cosmetic', usedFallback: false });
    expect(resolveServerCategoryRoute('food')).toEqual({ route: 'food', usedFallback: false });
  });

  test('falls back on empty/invalid values', () => {
    expect(resolveServerCategoryRoute('')).toEqual({ route: null, usedFallback: true });
    expect(resolveServerCategoryRoute(null)).toEqual({ route: null, usedFallback: true });
    expect(resolveServerCategoryRoute('beauty')).toEqual({ route: null, usedFallback: true });
  });
});

describe('deriveIngredientFlags', () => {
  const full = {
    ingredients_text: 'aqua, fragrance, palm kernel oil, sucralose',
    ingredients_analysis_tags: ['en:palm-oil-content-unknown']
  };

  test('hasIngredients is true when ingredients_text is non-empty', () => {
    expect(deriveIngredientFlags(full).hasIngredients).toBe(true);
  });

  test('hasIngredients is false when ingredients_text is empty', () => {
    expect(deriveIngredientFlags({}).hasIngredients).toBe(false);
  });

  test('hasPalmOil is true via analysis tag', () => {
    expect(
      deriveIngredientFlags({
        ingredients_analysis_tags: ['en:palm-oil-content-unknown'],
        ingredients_text: ''
      }).hasPalmOil
    ).toBe(true);
  });

  test('hasPalmOil is true via ingredients_text word "palm"', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'water, palm oil' }).hasPalmOil).toBe(true);
  });

  test('hasPalmOil is false when neither tag nor text matches', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'water, glycerin' }).hasPalmOil).toBe(false);
  });

  test('hasSweeteners is true via analysis tag', () => {
    expect(
      deriveIngredientFlags({
        ingredients_analysis_tags: ['en:sweetener'],
        ingredients_text: ''
      }).hasSweeteners
    ).toBe(true);
  });

  test('hasSweeteners is true via text match (sucralose)', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'sucralose, water' }).hasSweeteners).toBe(true);
  });

  test('hasSweeteners is true via text match (aspartame)', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'aspartame' }).hasSweeteners).toBe(true);
  });

  test('hasSweeteners is true via text match (saccharin)', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'saccharin sodium' }).hasSweeteners).toBe(true);
  });

  test('hasFragrance is true for "fragrance"', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'aqua, fragrance' }).hasFragrance).toBe(true);
  });

  test('hasFragrance is true for "parfum"', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'aqua, parfum' }).hasFragrance).toBe(true);
  });

  test('hasFragrance is true for "perfume"', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'aqua, perfume' }).hasFragrance).toBe(true);
  });

  test('hasFragrance is false when absent', () => {
    expect(deriveIngredientFlags({ ingredients_text: 'water, glycerin' }).hasFragrance).toBe(false);
  });

  test('returns all false on empty product', () => {
    const flags = deriveIngredientFlags({});
    expect(flags.hasIngredients).toBe(false);
    expect(flags.hasPalmOil).toBe(false);
    expect(flags.hasSweeteners).toBe(false);
    expect(flags.hasFragrance).toBe(false);
  });
});

describe('isSparseProductData', () => {
  test('returns false (not sparse) when both ingredients and categories present', () => {
    expect(
      isSparseProductData({
        ingredients_text: 'water, glycerin',
        categories_tags: ['en:cosmetics']
      })
    ).toBe(false);
  });

  test('returns true when ingredients_text is missing', () => {
    expect(isSparseProductData({ categories_tags: ['en:cosmetics'] })).toBe(true);
  });

  test('returns true when categories_tags is empty', () => {
    expect(isSparseProductData({ ingredients_text: 'water', categories_tags: [] })).toBe(true);
  });

  test('returns true when categories_tags is not an array', () => {
    expect(isSparseProductData({ ingredients_text: 'water', categories_tags: null })).toBe(true);
  });

  test('returns true when both fields are missing', () => {
    expect(isSparseProductData({})).toBe(true);
  });

  test('returns true when ingredients_text is whitespace only', () => {
    expect(
      isSparseProductData({
        ingredients_text: '   ',
        categories_tags: ['en:cosmetics']
      })
    ).toBe(true);
  });
});

describe('serializeBarcodeNotFoundForThread', () => {
  test('marks lookup_status and facts_source for beauty catalog', () => {
    const r = serializeBarcodeNotFoundForThread('049000042566', 'live_api', 'obf');
    expect(r.lookup_status).toBe('not_found');
    expect(r.barcode).toBe('049000042566');
    expect(r.facts_source).toBe('open_beauty_facts');
    expect(r.data_source).toBe('live_api');
  });

  test('uses open_food_facts when catalog is off', () => {
    const r = serializeBarcodeNotFoundForThread('049000042566', 'live_api', 'off');
    expect(r.facts_source).toBe('open_food_facts');
  });
});

describe('serializeObfProductForThread', () => {
  const richProduct = {
    barcode: '1234567890123',
    product_name: 'Test Serum',
    image_url: 'https://example.com/img.jpg',
    ingredients_text: 'water, niacinamide',
    labels: ['vegan', 'fragrance-free'],
    allergens: ['gluten'],
    categories_tags: ['en:cosmetics']
  };

  test('maps all fields correctly from a full product', () => {
    const result = serializeObfProductForThread(richProduct, 'obf_index_cache');
    expect(result.barcode).toBe('1234567890123');
    expect(result.product_name).toBe('Test Serum');
    expect(result.image_url).toBe('https://example.com/img.jpg');
    expect(result.ingredients_text).toBe('water, niacinamide');
    expect(result.labels).toEqual(['vegan', 'fragrance-free']);
    expect(result.allergens).toEqual(['gluten']);
    expect(result.categories_tags).toEqual(['en:cosmetics']);
    expect(result.data_source).toBe('obf_index_cache');
    expect(result.facts_source).toBe('open_beauty_facts');
  });

  test('sets facts_source open_food_facts when product.source is OFF', () => {
    const result = serializeObfProductForThread({ ...richProduct, source: 'open_food_facts' }, 'off_index_cache');
    expect(result.facts_source).toBe('open_food_facts');
  });

  test('falls back to image_front_url when image_url is absent', () => {
    const p = { ...richProduct, image_url: undefined, image_front_url: 'https://example.com/front.jpg' };
    expect(serializeObfProductForThread(p).image_url).toBe('https://example.com/front.jpg');
  });

  test('falls back to image_ingredients_url when front fields are absent', () => {
    const p = {
      ...richProduct,
      image_url: undefined,
      image_front_url: undefined,
      image_ingredients_url: 'https://example.com/ingredients.jpg'
    };
    expect(serializeObfProductForThread(p).image_url).toBe('https://example.com/ingredients.jpg');
  });

  test('sets image_url to null when neither image field is present', () => {
    const p = { ...richProduct, image_url: undefined, image_front_url: undefined };
    expect(serializeObfProductForThread(p).image_url).toBeNull();
  });

  test('trims whitespace from string fields', () => {
    const p = { barcode: '  123  ', product_name: '  Serum  ' };
    const result = serializeObfProductForThread(p);
    expect(result.barcode).toBe('123');
    expect(result.product_name).toBe('Serum');
  });

  test('sets data_source to null when not provided', () => {
    expect(serializeObfProductForThread(richProduct).data_source).toBeNull();
  });

  test('returns null for barcode when product.barcode is null', () => {
    expect(serializeObfProductForThread({ barcode: null }).barcode).toBeNull();
  });

  test('returns null for product_name when field is undefined', () => {
    expect(serializeObfProductForThread({}).product_name).toBeNull();
  });

  test('returns empty arrays when array fields are absent', () => {
    const result = serializeObfProductForThread({});
    expect(result.labels).toEqual([]);
    expect(result.allergens).toEqual([]);
    expect(result.categories_tags).toEqual([]);
  });

  test('caps arrays at 32 items', () => {
    const labels = Array.from({ length: 50 }, (_, i) => `label-${i}`);
    const result = serializeObfProductForThread({ labels });
    expect(result.labels).toHaveLength(32);
  });

  test('filters empty strings from arrays', () => {
    const result = serializeObfProductForThread({ labels: ['vegan', '', '  ', 'cruelty-free'] });
    expect(result.labels).toEqual(['vegan', 'cruelty-free']);
  });

  test('sets ingredients_text to null when field is absent', () => {
    expect(serializeObfProductForThread({}).ingredients_text).toBeNull();
  });

  test('preserves whitespace inside ingredients_text (no trimming)', () => {
    const text = '  water, glycerin  ';
    expect(serializeObfProductForThread({ ingredients_text: text }).ingredients_text).toBe(text);
  });
});

describe('compareProducts', () => {
  test('counts overlapping ingredients correctly', () => {
    const a = { ingredients_text: 'water, niacinamide, glycerin' };
    const b = { ingredients_text: 'niacinamide, glycerin, retinol' };
    const result = compareProducts(a, b);
    expect(result.overlapCount).toBe(2);
    expect(result.onlyA).toContain('water');
    expect(result.onlyB).toContain('retinol');
  });

  test('returns 0 overlap when products share no ingredients', () => {
    const a = { ingredients_text: 'water, glycerin' };
    const b = { ingredients_text: 'retinol, ceramide' };
    const result = compareProducts(a, b);
    expect(result.overlapCount).toBe(0);
    expect(result.onlyA).toEqual(['water', 'glycerin']);
    expect(result.onlyB).toEqual(['retinol', 'ceramide']);
  });

  test('comparison is case-insensitive', () => {
    const a = { ingredients_text: 'Niacinamide' };
    const b = { ingredients_text: 'niacinamide' };
    expect(compareProducts(a, b).overlapCount).toBe(1);
  });

  test('handles empty ingredients gracefully', () => {
    const result = compareProducts({}, {});
    expect(result.overlapCount).toBe(0);
    expect(result.onlyA).toEqual([]);
    expect(result.onlyB).toEqual([]);
  });

  test('caps onlyA and onlyB at 6 items', () => {
    const aIngredients = Array.from({ length: 10 }, (_, i) => `ing${i}`).join(', ');
    const result = compareProducts({ ingredients_text: aIngredients }, {});
    expect(result.onlyA.length).toBeLessThanOrEqual(6);
  });

  test('handles one side empty', () => {
    const a = { ingredients_text: 'water, retinol' };
    const result = compareProducts(a, {});
    expect(result.overlapCount).toBe(0);
    expect(result.onlyA).toEqual(['water', 'retinol']);
    expect(result.onlyB).toEqual([]);
  });
});

describe('buildPinnedContextText', () => {
  const scanResult = {
    barcode: '1234567890123',
    product: { product_name: 'Glow Serum', ingredients_text: 'water, niacinamide' },
    categoryRoute: 'cosmetic',
    dataSource: 'obf_index_cache'
  };

  test('produces pinned context with product, ingredients, category, provenance, and skin guidance', () => {
    const text = buildPinnedContextText(scanResult);
    expect(text).toContain('[Pinned Product Context]');
    expect(text).toContain('Glow Serum');
    expect(text).toContain('1234567890123');
    expect(text).toContain('Ingredients:');
    expect(text).toContain('Category Route: cosmetic');
    expect(text).toContain('Provenance: obf_index_cache');
    expect(text).toContain('Skin & care:');
    expect(text).not.toContain('Matched in:');
  });

  test('includes auto-detected catalog line when resolvedCatalog is set', () => {
    const text = buildPinnedContextText({
      ...scanResult,
      resolvedCatalog: 'off'
    });
    expect(text).toContain('Matched in: Open Food Facts (auto-detected)');
  });

  test('omits the Ingredients line when ingredients_text is absent', () => {
    const result = {
      ...scanResult,
      product: { product_name: 'Sparse Product' }
    };
    const text = buildPinnedContextText(result);
    expect(text).not.toContain('Ingredients:');
  });

  test('falls back to barcode when product_name is absent', () => {
    const result = { ...scanResult, product: {} };
    const text = buildPinnedContextText(result);
    expect(text).toContain('1234567890123');
  });

  test('shows "unknown" when both product_name and barcode are absent', () => {
    const text = buildPinnedContextText({});
    expect(text).toContain('unknown');
  });

  test('truncates ingredients_text to 900 chars', () => {
    const longText = 'a'.repeat(1000);
    const result = { ...scanResult, product: { ingredients_text: longText } };
    const text = buildPinnedContextText(result);
    const match = text.match(/Ingredients: (.+)/);
    expect(match).not.toBeNull();
    expect(match[1].length).toBe(900);
  });

  test('falls back to "unknown" for categoryRoute when absent', () => {
    const result = { ...scanResult, categoryRoute: undefined };
    expect(buildPinnedContextText(result)).toContain('Category Route: unknown');
  });

  test('falls back to "unknown" for dataSource when absent', () => {
    const result = { ...scanResult, dataSource: undefined };
    expect(buildPinnedContextText(result)).toContain('Provenance: unknown');
  });
});

describe('buildFollowupMessageWithPinnedContext', () => {
  const scanResult = {
    barcode: '1234567890123',
    product: { product_name: 'Glow Serum', ingredients_text: 'water' },
    categoryRoute: 'cosmetic',
    dataSource: 'obf_index_cache'
  };

  test('appends pinned context when isPinnedReady is true', () => {
    const out = buildFollowupMessageWithPinnedContext('Is this safe?', scanResult, true);
    expect(out).toContain('Is this safe?');
    expect(out).toContain('[Pinned Product Context]');
  });

  test('returns bare message when isPinnedReady is false', () => {
    const out = buildFollowupMessageWithPinnedContext('Is this safe?', scanResult, false);
    expect(out).toBe('Is this safe?');
  });

  test('returns bare message when scanResult has no product', () => {
    const out = buildFollowupMessageWithPinnedContext('Hi', { barcode: '123' }, true);
    expect(out).toBe('Hi');
  });

  test('returns bare message when scanResult has no barcode', () => {
    const out = buildFollowupMessageWithPinnedContext('Hi', { product: { product_name: 'X' } }, true);
    expect(out).toBe('Hi');
  });

  test('returns bare message when scanResult is null', () => {
    const out = buildFollowupMessageWithPinnedContext('Hi', null, true);
    expect(out).toBe('Hi');
  });

  test('trims whitespace from the user message', () => {
    const out = buildFollowupMessageWithPinnedContext('  Hi  ', null, false);
    expect(out).toBe('Hi');
  });

  test('handles empty string input gracefully', () => {
    const out = buildFollowupMessageWithPinnedContext('', scanResult, true);
    expect(typeof out).toBe('string');
  });

  test('combined output is separated by a blank line', () => {
    const out = buildFollowupMessageWithPinnedContext('Question', scanResult, true);
    expect(out).toContain('Question\n\n[Pinned Product Context]');
  });
});
