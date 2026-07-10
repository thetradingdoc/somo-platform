'use strict';

jest.mock('../services/knowledge-service', () => {
  const actual = jest.requireActual('../services/knowledge-service');
  return {
    ...actual,
    validateCodesExist: () => ({ valid: true, invalid: [] }),
    validateCodePair: () => ({ valid: true })
  };
});

jest.mock('../database', () => ({
  db: { prepare: () => ({ get: () => null }) },
  insertKellyCallEvent: jest.fn()
}));

const { resolveInsuranceCodes } = require('../services/resolve-insurance-codes');

describe('J-05 quote-before-book coding gate', () => {
  test('admin path returns resolved CPT not client hardcode', () => {
    const r = resolveInsuranceCodes('sess_j05', {
      triage_policy: 'disabled',
      tenantSpecialty: 'healthcare_clinic',
      visit_reason: 'follow up visit',
      service_code: 'D1110'
    });
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toMatch(/^99/);
  });
});
