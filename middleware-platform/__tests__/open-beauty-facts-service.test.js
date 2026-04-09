'use strict';

const { normalizeProduct } = require('../services/open-beauty-facts-service');
const { resolveProductGrade } = require('../services/product-grade-resolver');

describe('open-beauty-facts-service normalizeProduct', () => {
  test('passes taxonomy tags, analysis tags, states_tags, structured ingredients, product_type', () => {
    const n = normalizeProduct({
      status: 1,
      code: '123',
      product: {
        product_name: 'Test',
        categories: 'Face, Cream',
        categories_tags: ['en:face-creams', 'en:moisturizers'],
        categories_hierarchy: ['en:beauty', 'en:face-creams'],
        ingredients_analysis_tags: ['en:contains-fragrance'],
        states_tags: ['en:categories-completed'],
        ingredients: [{ id: 'en:glycerin', text: 'Glycerin', percent_estimate: 5 }],
        product_type: 'beauty'
      }
    });
    expect(n.categories_tags).toEqual(['en:face-creams', 'en:moisturizers']);
    expect(n.categories_hierarchy[0]).toBe('en:beauty');
    expect(n.ingredients_analysis_tags).toContain('en:contains-fragrance');
    expect(n.states_tags).toContain('en:categories-completed');
    expect(n.ingredients[0]).toMatchObject({ id: 'en:glycerin', text: 'Glycerin', percent_estimate: 5 });
    expect(n.product_type).toBe('beauty');
  });
});

describe('product-grade-resolver with taxonomy tags', () => {
  test('accepts categories_tags and structured ingredients', () => {
    const r = resolveProductGrade({
      productName: 'Sunscreen SPF 50',
      labels: [],
      categories: ['Sun care'],
      categories_tags: ['en:sunscreen'],
      ingredients_analysis_tags: [],
      states_tags: [],
      ingredients: [{ text: 'water', id: 'en:water' }]
    });
    expect(r.grade_class).toBeDefined();
    expect(r.rationale).toBeDefined();
  });
});
