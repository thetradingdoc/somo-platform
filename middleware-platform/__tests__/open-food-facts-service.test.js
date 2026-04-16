'use strict';

const { normalizeProduct } = require('../services/open-food-facts-service');

describe('open-food-facts-service normalizeProduct', () => {
  test('marks source open_food_facts and maps core fields', () => {
    const n = normalizeProduct({
      status: 1,
      code: '3017620422003',
      product: {
        product_name: 'Test Chocolate',
        categories_tags: ['en:snacks'],
        categories_hierarchy: ['en:snacks'],
        ingredients_text: 'sugar, cocoa',
        ingredients: [{ id: 'en:sugar', text: 'Sugar' }],
        allergens: 'Gluten',
        labels: 'Organic'
      }
    });
    expect(n.source).toBe('open_food_facts');
    expect(n.barcode).toBe('3017620422003');
    expect(n.found).toBe(true);
    expect(n.product_name).toBe('Test Chocolate');
    expect(n.categories_tags).toContain('en:snacks');
    expect(n.ingredients[0]).toMatchObject({ id: 'en:sugar', text: 'Sugar' });
  });

  test('builds ingredients_text from structured ingredients when text fields are empty', () => {
    const n = normalizeProduct({
      status: 1,
      code: '0012993441081',
      product: {
        product_name: 'Sparkling Water',
        categories_tags: ['en:beverages'],
        ingredients_text: ' ',
        ingredients: [
          { id: 'en:carbonated-water', text: 'carbonated water' },
          { id: 'en:natural-flavouring', text: 'natural flavour' }
        ]
      }
    });
    expect(n.ingredients_text).toMatch(/carbonated water/i);
    expect(n.ingredients_text).toMatch(/natural flavour/i);
  });
});
