'use strict';

const { up } = require('../migrations/038_nyc_consumer_metal_tests');
const {
  buildNycMetalContext,
  normalizeProductName,
  significantTokens,
  parseConcentration
} = require('../services/nyc-metal-context-service');

describe('nyc-metal-context-service', () => {
  const db = require('../database').db;

  beforeAll(() => {
    up(db);
    db.prepare('DELETE FROM nyc_consumer_metal_tests WHERE dataset_version = ?').run('test_nyc');
    const ins = db.prepare(`
      INSERT INTO nyc_consumer_metal_tests (
        source_row_id, product_type, product_name, product_name_normalized, metal,
        concentration_ppm, is_not_detected, units, dataset_version
      ) VALUES (@source_row_id, @product_type, @product_name, @product_name_normalized, @metal,
        @concentration_ppm, @is_not_detected, 'ppm', @dataset_version)
    `);
    ins.run({
      source_row_id: 't1',
      product_type: 'Food-Spice',
      product_name: 'Turmeric powder',
      product_name_normalized: normalizeProductName('Turmeric powder'),
      metal: 'Lead',
      concentration_ppm: 2.9,
      is_not_detected: 0,
      dataset_version: 'test_nyc'
    });
    ins.run({
      source_row_id: 't2',
      product_type: 'Food-Spice',
      product_name: 'Turmeric powder',
      product_name_normalized: normalizeProductName('Turmeric powder'),
      metal: 'Lead',
      concentration_ppm: 610,
      is_not_detected: 0,
      dataset_version: 'test_nyc'
    });
    ins.run({
      source_row_id: 't3',
      product_type: 'Food-Spice',
      product_name: 'Organic turmeric',
      product_name_normalized: normalizeProductName('Organic turmeric'),
      metal: 'Lead',
      concentration_ppm: null,
      is_not_detected: 1,
      dataset_version: 'test_nyc'
    });
  });

  test('normalizeProductName collapses punctuation', () => {
    expect(normalizeProductName('Johnson & Johnson Baby Powder')).toContain('johnson');
    expect(normalizeProductName('Johnson & Johnson Baby Powder')).toContain('powder');
  });

  test('significantTokens prefers longer words', () => {
    const t = significantTokens('Organic Turmeric Powder');
    expect(t).toContain('turmeric');
    expect(t).toContain('organic');
    expect(t).toContain('powder');
  });

  test('parseConcentration handles comma and -1', () => {
    expect(parseConcentration('-1').isNotDetected).toBe(true);
    expect(parseConcentration('610,000').ppm).toBe(610000);
    expect(parseConcentration('2.9').ppm).toBe(2.9);
  });

  test('buildNycMetalContext returns aggregates and honest summary for turmeric-like product', () => {
    process.env.NYC_METAL_DATASET_VERSION = 'test_nyc';
    const ctx = buildNycMetalContext({
      productName: 'Organic Turmeric Powder',
      categoriesTags: ['en:spices'],
      ingredients_text: 'turmeric, black pepper',
      factsSource: 'open_food_facts'
    });
    expect(ctx).toBeTruthy();
    expect(ctx.match_tier).not.toBe('none');
    expect(ctx.metals.some((m) => m.metal === 'Lead')).toBe(true);
    const lead = ctx.metals.find((m) => m.metal === 'Lead');
    expect(lead.max_ppm).toBe(610);
    expect(ctx.summary).toMatch(/ingredient disclosure|ingredient list/i);
    expect(ctx.sample_rows.length).toBeGreaterThan(0);
  });

  test('buildNycMetalContext returns none tier when no rows match', () => {
    const ctx = buildNycMetalContext({
      productName: 'ZyphorQuantum999 Synthetic',
      ingredients_text: 'water',
      factsSource: 'open_food_facts'
    });
    expect(ctx.match_tier).toBe('none');
    expect(ctx.sample_rows.length).toBe(0);
  });
});
