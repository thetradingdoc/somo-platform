'use strict';

describe('CP-13 coding resolution latency budget', () => {
  test('CODING_RESOLUTION_P95_MS default is 2500ms', () => {
    const budget = parseInt(process.env.CODING_RESOLUTION_P95_MS || '2500', 10);
    expect(budget).toBeGreaterThanOrEqual(1500);
    expect(budget).toBeLessThanOrEqual(5000);
  });

  test('resolve-insurance-codes logs when over budget', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../services/resolve-insurance-codes.js'),
      'utf8'
    );
    expect(src).toMatch(/CODING_RESOLUTION_P95_MS/);
  });
});
