'use strict';

describe('C-BR benefit ingest coverage', () => {
  const sample = require('../../Knowledge/rules/plan-rules-benefit-sample.json');

  test('sample defines 3 dental payers × specialty codes', () => {
    const payers = new Set(sample.map((r) => r.payer_id));
    expect(payers.size).toBeGreaterThanOrEqual(3);
    expect(sample.some((r) => /^D33/.test(r.service_code))).toBe(true);
    expect(sample.some((r) => /^D43/.test(r.service_code))).toBe(true);
    expect(sample.some((r) => /^D11/.test(r.service_code))).toBe(true);
  });

  test('import script maps service_code to code_pattern', () => {
    const fs = require('fs');
    const path = require('path');
    const script = fs.readFileSync(
      path.join(__dirname, '../scripts/import-plan-rules-benefits.cjs'),
      'utf8'
    );
    expect(script).toMatch(/code_pattern/);
    expect(script).toMatch(/service_code/);
    expect(script).toMatch(/copay_value/);
  });
});
