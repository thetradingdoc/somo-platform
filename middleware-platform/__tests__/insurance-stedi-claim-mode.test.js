'use strict';

const InsuranceService = require('../services/insurance-service');

describe('InsuranceService Stedi claim mode', () => {
  const orig = process.env.STEDI_CLAIM_SUBMISSION_MODE;

  afterEach(() => {
    if (orig === undefined) delete process.env.STEDI_CLAIM_SUBMISSION_MODE;
    else process.env.STEDI_CLAIM_SUBMISSION_MODE = orig;
  });

  test('defaults to institutional', () => {
    delete process.env.STEDI_CLAIM_SUBMISSION_MODE;
    delete process.env.STEDI_USE_PROFESSIONAL_CLAIMS;
    expect(InsuranceService.getStediClaimSubmissionMode()).toBe('institutional');
    expect(InsuranceService.getStediClaimApiPaths().submit).toContain('institutionalclaims');
  });

  test('professional mode uses professionalclaims path', () => {
    process.env.STEDI_CLAIM_SUBMISSION_MODE = 'professional';
    expect(InsuranceService.getStediClaimSubmissionMode()).toBe('professional');
    expect(InsuranceService.getStediClaimApiPaths().submit).toContain('professionalclaims');
  });

  test('STEDI_API_BASE does not use legacy api.stedi.com host', () => {
    expect(String(InsuranceService.STEDI_API_BASE)).not.toContain('api.stedi.com');
  });
});
