'use strict';

jest.mock('../services/knowledge-service', () => ({
  getCodeCandidatesDualSource: jest.fn(),
  validateCodePair: jest.fn(() => ({ valid: true }))
}));

const knowledgeService = require('../services/knowledge-service');
const visitCodes = require('../services/visit-codes-service');

describe('visit-codes ranking SSOT (CP-05)', () => {
  beforeEach(() => {
    knowledgeService.validateCodePair.mockImplementation((icd, cpt) => ({
      valid: icd === 'I10' ? cpt === '99213' : true
    }));
  });

  test('prefers higher-confidence ICD over retrieval order', async () => {
    knowledgeService.getCodeCandidatesDualSource.mockResolvedValue({
      icd10: [
        { code: 'R10.9', confidence: 0.55 },
        { code: 'K29.70', confidence: 0.93 }
      ],
      cpt: [{ code: '99213', confidence: 0.8 }],
      hcpcs: []
    });
    const result = await visitCodes.getVisitCodes('stomach pain', {});
    expect(result.primary_icd10).toBe('K29.70');
  });

  test('pair_validation category picks valid CPT over higher-confidence invalid', async () => {
    knowledgeService.getCodeCandidatesDualSource.mockResolvedValue({
      icd10: [{ code: 'I10', confidence: 0.9 }],
      cpt: [
        { code: '99285', confidence: 0.99 },
        { code: '99213', confidence: 0.7 }
      ],
      hcpcs: []
    });
    const result = await visitCodes.getVisitCodes('hypertension office visit', {});
    expect(result.primary_cpt).toBe('99213');
    expect(result.pair_valid).toBe(true);
  });
});
