'use strict';

/**
 * A-06 — healthcare_clinic admin coding E2E structural test.
 */

const { resolveVisitCodingPath } = require('../services/resolve-visit-codes');
const { resolveAdminInsuranceCodes } = require('../services/resolve-admin-visit-codes');

describe('tenant coding path matrix (A-06)', () => {
  test('dental uses admin path without RAG', () => {
    const r = resolveVisitCodingPath({
      triagePolicy: 'disabled',
      tenantSpecialty: 'Dental',
      visitReason: 'dental cleaning'
    });
    expect(r.path).toBe('admin_dental');
    expect(r.requiresTriageRag).toBe(false);
  });

  test('healthcare_clinic uses admin path', () => {
    const r = resolveVisitCodingPath({
      triagePolicy: 'disabled',
      tenantSpecialty: 'healthcare_clinic',
      visitReason: 'annual checkup'
    });
    expect(r.path).toBe('admin_clinic');
    const admin = resolveAdminInsuranceCodes({
      visit_reason: 'annual checkup',
      tenantSpecialty: 'healthcare_clinic'
    });
    expect(admin.ok).toBe(true);
    expect(admin.primary_cpt).toBe('99395');
  });

  test('dermatology required uses RAG path', () => {
    const r = resolveVisitCodingPath({
      triagePolicy: 'required',
      tenantSpecialty: 'Dermatology',
      visitReason: 'itchy rash'
    });
    expect(r.path).toBe('rag');
    expect(r.requiresTriageRag).toBe(true);
  });
});
