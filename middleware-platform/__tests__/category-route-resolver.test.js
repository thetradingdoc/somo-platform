const { resolveCategoryRoute, normalizeTags } = require('../services/category-route-resolver');

describe('category-route-resolver', () => {
  test('maps common beauty tags', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: ['en:shampoos', 'en:hair']
    });
    expect(out.route).toBe('hygiene');
    expect(out.confidence_band).toBe('high');
    expect(out.map_version).toBe('1.0.0');
  });

  test('resolves conflicts by precedence', () => {
    const out = resolveCategoryRoute({
      source: 'open_food_facts',
      categories_tags: ['en:shampoos', 'en:non-food-products']
    });
    expect(out.route).toBe('non_food');
    expect(out.conflict).toBe(true);
    expect(out.confidence_band).toBe('medium');
  });

  test('prefers cosmetic over food when OFF tags conflict (dual-labelled personal care)', () => {
    const out = resolveCategoryRoute({
      source: 'open_food_facts',
      categories_tags: ['en:cosmetics', 'en:beverages']
    });
    expect(out.route).toBe('cosmetic');
    expect(out.conflict).toBe(true);
  });

  test('returns unknown for no matches', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: ['en:unmapped-category']
    });
    expect(out.route).toBe('unknown');
    expect(out.confidence_band).toBe('low');
    expect(out.review_eligible).toBe(true);
  });

  test('uses positive title heuristics for supplement', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: [],
      product_name: 'Daily Vitamin Gummies'
    });
    expect(out.route).toBe('supplement');
    expect(out.source).toBe('heuristic');
    expect(out.rule_id).toBe('title_supplement');
  });

  test('uses negative top-ingredient heuristic for food', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: [],
      ingredients_text: 'Sugar, flour, cocoa butter, flavoring'
    });
    expect(out.route).toBe('food');
    expect(out.source).toBe('heuristic');
  });

  test('does not override strong map match with heuristics', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: ['en:shampoos'],
      product_name: 'Protein powder shampoo',
      ingredients_text: 'Whey protein, water'
    });
    expect(out.route).toBe('hygiene');
    expect(out.source).toBe('taxonomy_map');
  });

  test('does not override conflicting map match with heuristics', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: ['en:non-food-products', 'en:moisturizers'],
      product_name: 'Retinol moisturizer',
      ingredients_text: 'retinol, water'
    });
    expect(out.route).toBe('non_food');
    expect(out.source).toBe('taxonomy_map');
    expect(out.conflict).toBe(true);
  });

  test('normalizes alias tags before mapping', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: ['fr:cosmetique']
    });
    expect(out.route).toBe('cosmetic');
  });

  test('suppresses meta/noise tags from routing signals', () => {
    const out = resolveCategoryRoute({
      source: 'open_beauty_facts',
      categories_tags: ['en:open-beauty-facts']
    });
    expect(out.route).toBe('unknown');
    expect(out.rule_id).toBe('no_matching_tag');
  });

  test('normalizeTags drops suppressed tags and applies aliases', () => {
    const out = normalizeTags([' en:open-beauty-facts ', 'fr:cosmetique']);
    expect(out).toContain('en:cosmetic-products');
    expect(out).not.toContain('en:open-beauty-facts');
  });
});
