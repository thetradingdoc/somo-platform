import {
  buildPinnedContextText,
  buildFollowupMessageWithPinnedContext,
  compareProducts,
  deriveCategoryRoute,
  deriveIngredientFlags,
  isSparseProductData
} from './scanInsights';

test('routes category tags correctly', () => {
  expect(deriveCategoryRoute(['en:cosmetic-product'])).toBe('cosmetic');
  expect(deriveCategoryRoute(['en:hygiene-products'])).toBe('hygiene');
  expect(deriveCategoryRoute(['en:non-food-products'])).toBe('non_food');
  expect(deriveCategoryRoute([])).toBe('unknown');
});

test('derives ingredient flags from analysis and text', () => {
  const out = deriveIngredientFlags({
    ingredients_analysis_tags: ['en:palm-oil-content-unknown'],
    ingredients_text: 'Water, Parfum'
  });
  expect(out.hasIngredients).toBe(true);
  expect(out.hasPalmOil).toBe(true);
  expect(out.hasFragrance).toBe(true);
});

test('marks sparse data when categories/ingredients absent', () => {
  expect(isSparseProductData({ ingredients_text: '', categories_tags: ['en:cosmetic'] })).toBe(true);
  expect(isSparseProductData({ ingredients_text: 'Water', categories_tags: [] })).toBe(true);
  expect(isSparseProductData({ ingredients_text: 'Water', categories_tags: ['en:cosmetic'] })).toBe(false);
});

test('builds pinned context with provenance', () => {
  const txt = buildPinnedContextText({
    barcode: '12345678',
    dataSource: 'obf_index_cache',
    categoryRoute: 'cosmetic',
    product: { product_name: 'Test Serum', ingredients_text: 'Water, Glycerin' }
  });
  expect(txt).toContain('[Pinned Product Context]');
  expect(txt).toContain('Provenance: obf_index_cache');
  expect(txt).toContain('Category Route: cosmetic');
});

test('compares products A vs B', () => {
  const cmp = compareProducts({ ingredients_text: 'water, glycerin, parfum' }, { ingredients_text: 'water, niacinamide' });
  expect(cmp.overlapCount).toBe(1);
  expect(cmp.onlyA.length).toBeGreaterThan(0);
  expect(cmp.onlyB.length).toBeGreaterThan(0);
});

test('follow-up message includes pinned context when ready', () => {
  const scanResult = {
    barcode: '12345678',
    dataSource: 'live_api',
    categoryRoute: 'cosmetic',
    product: { product_name: 'Alpha Serum', ingredients_text: 'Water, Glycerin' }
  };
  const msg = buildFollowupMessageWithPinnedContext('Can I use this daily?', scanResult, true);
  expect(msg).toContain('Can I use this daily?');
  expect(msg).toContain('[Pinned Product Context]');
  expect(msg).toContain('Alpha Serum');
});

