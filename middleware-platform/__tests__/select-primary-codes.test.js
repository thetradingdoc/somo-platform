'use strict';

const {
  selectPrimaryIcd10,
  selectPrimaryProcedure
} = require('../services/select-primary-codes');

describe('select-primary-codes (F-01)', () => {
  test('prefers higher-confidence ICD over array order', () => {
    const icd = [
      { code: 'L70.0', confidence: 0.5 },
      { code: 'L30.9', confidence: 0.92 }
    ];
    expect(selectPrimaryIcd10(icd, [])).toBe('L30.9');
  });

  test('prefers pair-valid CPT over invalid when ICD set', () => {
    const pick = selectPrimaryProcedure({
      cptCandidates: [
        { code: '99285', confidence: 0.95 },
        { code: '99213', confidence: 0.7 }
      ],
      hcpcsCandidates: [],
      primaryIcd10: 'Z00.00',
      telehealthIntent: false
    });
    expect(pick.code).toBe('99213');
    expect(pick.pair_valid).toBe(true);
  });

  test('selects HCPCS when no CPT and wellness G-code present', () => {
    const pick = selectPrimaryProcedure({
      cptCandidates: [],
      hcpcsCandidates: [{ code: 'G0438', confidence: 0.88 }],
      primaryIcd10: 'Z00.00'
    });
    expect(pick.code_type).toBe('hcpcs');
    expect(pick.code).toBe('G0438');
  });
});
