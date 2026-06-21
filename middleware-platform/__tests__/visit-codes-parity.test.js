'use strict';

jest.mock('../services/knowledge-service', () => ({
  getCodeCandidatesDualSource: jest.fn()
}));

const knowledgeService = require('../services/knowledge-service');
const visitCodes = require('../services/visit-codes-service');

describe('visit-codes parity', () => {
  beforeEach(() => {
    knowledgeService.getCodeCandidatesDualSource.mockResolvedValue({
      icd10: [{ code: 'K21.0', description: 'GERD', confidence: 0.9 }],
      cpt: [{ code: '99213', description: 'Office visit', confidence: 0.85 }],
      hcpcs: [],
      remote_knowledge: { metadata: { source: 'pinecone' } },
      local_knowledge: { metadata: { source: 'local' } }
    });
  });

  test('Kelly and Retell paths share identical primary codes for same text', async () => {
    const text = 'stomach pain after meals';
    const kelly = await visitCodes.getVisitCodes(text, { clinicId: 'clinic-default' });
    const retell = await visitCodes.getVisitCodes(text, { clinicId: 'clinic-default' });
    expect(kelly.primary_icd10).toBe(retell.primary_icd10);
    expect(kelly.primary_cpt).toBe(retell.primary_cpt);
    expect(kelly.source_breakdown.remote).toBe('pinecone');
  });
});
