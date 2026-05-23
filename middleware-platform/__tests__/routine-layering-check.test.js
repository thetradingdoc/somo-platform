'use strict';

const { extractActivesFromSteps, runLayeringCheck } = require('../lib/routine-layering-check');

describe('routine-layering-check', () => {
  test('extractActivesFromSteps finds retinol and BHA', () => {
    const ids = extractActivesFromSteps([
      { product_name: 'Tretinoin 0.025% cream' },
      { product_name: 'Salicylic acid 2% toner' },
    ]);
    expect(ids).toContain('retinol');
    expect(ids).toContain('salicylic acid');
  });

  test('runLayeringCheck returns structure', () => {
    const result = runLayeringCheck({
      steps: [{ product_name: 'Gentle cleanser' }],
      db: {},
    });
    expect(result.overall).toBe('safe');
    expect(Array.isArray(result.actives_detected)).toBe(true);
  });
});
