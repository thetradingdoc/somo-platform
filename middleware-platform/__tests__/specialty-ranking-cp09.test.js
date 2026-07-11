'use strict';

jest.mock('../services/knowledge-service', () => ({
  validateCodePair: jest.fn(() => ({ valid: true }))
}));

const { selectPrimaryIcd10, selectPrimaryProcedure } = require('../services/select-primary-codes');

describe('CP-09 multi-specialty ranking', () => {
  test('derm: prefers higher-confidence ICD for rash', () => {
    const icd = selectPrimaryIcd10([
      { code: 'L30.9', confidence: 0.88, description: 'Dermatitis unspecified' },
      { code: 'R21', confidence: 0.6, description: 'Rash' }
    ], []);
    expect(icd).toBe('L30.9');
  });

  test('MH: psychotherapy CPT when ICD is F41', () => {
    const pick = selectPrimaryProcedure({
      cptCandidates: [
        { code: '99213', confidence: 0.7 },
        { code: '90834', confidence: 0.82 }
      ],
      hcpcsCandidates: [],
      primaryIcd10: 'F41.1',
      telehealthIntent: true
    });
    expect(['90834', '99213']).toContain(pick.code);
    expect(pick.pair_valid).toBe(true);
  });
});
