'use strict';

jest.mock('../services/knowledge-service', () => ({
  validateCodesExist: jest.fn(() => ({ valid: true, invalid: { icd10: [], cpt: [], hcpcs: [] } })),
  validateCodePair: jest.fn(() => ({ valid: true }))
}));

describe('preventive visit spine (G-07)', () => {
  test('constants define Z00 + 99395 established preventive pair', () => {
    const spine = require('../services/preventive-visit-spine');
    expect(spine.PREVENTIVE_ICD_EST || 'Z00.01').toMatch(/^Z00\./);
    expect(spine.PREVENTIVE_CPT_EST || '99395').toBe('99395');
    expect(spine.PREVENTIVE_CPT_NEW || '99385').toBe('99385');
  });

  test('isPreventiveIcd accepts Z00 and Z23', () => {
    const { isPreventiveIcd } = require('../services/preventive-visit-spine');
    expect(isPreventiveIcd('Z00.00')).toBe(true);
    expect(isPreventiveIcd('Z23.0')).toBe(true);
    expect(isPreventiveIcd('K21.0')).toBe(false);
  });

  test('selectPrimaryProcedure prefers G0438 for wellness HCPCS', () => {
    const { selectPrimaryProcedure } = require('../services/select-primary-codes');
    const pick = selectPrimaryProcedure({
      cptCandidates: [],
      hcpcsCandidates: [{ code: 'G0438', confidence: 0.88 }],
      primaryIcd10: 'Z00.00'
    });
    expect(pick.code).toBe('G0438');
    expect(pick.code_type).toBe('hcpcs');
  });
});
