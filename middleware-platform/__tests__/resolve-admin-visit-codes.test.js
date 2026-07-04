'use strict';

const { resolveAdminVisitCodes, resolveAdminInsuranceCodes } = require('../services/resolve-admin-visit-codes');

describe('resolve-admin-visit-codes', () => {
  test('maps cleaning to D1110', () => {
    const r = resolveAdminVisitCodes('I need a cleaning', 'Dental');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D1110');
    expect(r.code_source).toBe('admin_dental');
  });

  test('maps new patient to D0150', () => {
    const r = resolveAdminVisitCodes('first time here new patient', 'Dental');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D0150');
  });

  test('requires visit reason', () => {
    const r = resolveAdminVisitCodes('', 'Dental');
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('VISIT_REASON_REQUIRED');
  });

  test('resolveAdminInsuranceCodes returns admin_path', () => {
    const r = resolveAdminInsuranceCodes({ visit_reason: 'cleaning', tenantSpecialty: 'Dental' });
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D1110');
    expect(r.admin_path).toBe(true);
  });

  test('maps crown to D2740', () => {
    const r = resolveAdminVisitCodes('I need a crown', 'Dental');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D2740');
  });

  test('maps implant consult to D6010', () => {
    const r = resolveAdminVisitCodes('implant consult', 'Dental');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D6010');
  });

  test('maps ortho to D8080', () => {
    const r = resolveAdminVisitCodes('braces ortho', 'Dental');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D8080');
  });

  test('maps perio maintenance to D4910', () => {
    const perio = resolveAdminVisitCodes('periodontal maintenance', 'Dental');
    expect(perio.ok).toBe(true);
    expect(perio.primary_cpt).toBe('D4910');
  });
});
