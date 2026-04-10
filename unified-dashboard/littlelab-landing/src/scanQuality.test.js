import { buildScanQuality } from './scanQuality';

describe('buildScanQuality', () => {
  test('returns full when name, ingredients, categories exist', () => {
    const out = buildScanQuality({
      product_name: 'Cleanser',
      ingredients_text: 'water, glycerin',
      categories_tags: ['en:cleanser'],
      image_url: 'https://img'
    });
    expect(out.tier).toBe('full');
    expect(out.analyzeEnabled).toBe(true);
    expect(out.analyzeLabel).toBe('Analyze for my skin');
  });

  test('returns partial with enabled analyze when ingredients exist', () => {
    const out = buildScanQuality({
      product_name: 'Serum',
      ingredients_text: 'water, niacinamide',
      categories_tags: []
    });
    expect(out.tier).toBe('partial');
    expect(out.analyzeEnabled).toBe(true);
  });

  test('returns insufficient when sparse product', () => {
    const out = buildScanQuality({
      product_name: '',
      ingredients_text: '',
      categories_tags: []
    });
    expect(out.tier).toBe('insufficient');
    expect(out.analyzeEnabled).toBe(false);
    expect(out.analyzeLabel).toBe('Add ingredients to analyze');
  });
});

