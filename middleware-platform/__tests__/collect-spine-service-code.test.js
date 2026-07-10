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

describe('M-02/M-03 collect spine service_code', () => {
  test('admin dental cleaning resolves D1110 not client code', () => {
    const r = resolveInsuranceCodes('sess_m02', {
      triage_policy: 'disabled',
      tenantSpecialty: 'Dental',
      visit_reason: 'I need a cleaning',
      service_code: '99213'
    });
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toMatch(/^D/);
    expect(r.primary_cpt).not.toBe('99213');
  });

  test('rejects client service_code on RAG path', () => {
    const r = resolveInsuranceCodes('sess_m03', {
      service_code: '99213',
      triage_policy: 'enabled'
    });
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('CLIENT_SERVICE_CODE_REJECTED');
  });
});
