'use strict';

const codingTools = require('../services/coding-voice-tools');

describe('Kelly coding voice tools contract (J-01)', () => {
  test('searchIcd10Codes returns array', async () => {
    const r = await codingTools.searchIcd10Codes({ query: 'chest pain', limit: 3 });
    expect(r.success).toBe(true);
    expect(Array.isArray(r.codes)).toBe(true);
  });

  test('searchCptCodes returns array', async () => {
    const r = await codingTools.searchCptCodes({ query: 'office visit', limit: 3 });
    expect(r.success).toBe(true);
    expect(r.codes.length).toBeGreaterThanOrEqual(0);
  });

  test('validateCodePair runs', () => {
    const r = codingTools.validateCodePair({ icd10: 'Z00.00', cpt: '99213' });
    expect(r.success).toBe(true);
    expect(typeof r.valid).toBe('boolean');
  });

  test('suggestCodesFromSymptoms returns icd/cpt keys', async () => {
    const r = await codingTools.suggestCodesFromSymptoms(
      { symptoms: 'annual wellness checkup' },
      { sessionId: 'contract-test' }
    );
    expect(r.success).toBe(true);
    expect(r).toHaveProperty('icd10');
  });
});
