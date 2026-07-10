'use strict';

const {
  resolveVisitCodingPath,
  validatePayerClassForCollect,
  CODING_PATH,
  shouldForceRagForConditional
} = require('../services/resolve-visit-codes');
const { TriagePolicy } = require('../services/conversation-mode/tenant-policy');

describe('resolve-visit-codes', () => {
  test('dental disabled uses admin_dental', () => {
    const r = resolveVisitCodingPath({
      useCase: 'dental',
      triagePolicy: TriagePolicy.DISABLED,
      visitReason: 'cleaning'
    });
    expect(r.path).toBe(CODING_PATH.ADMIN_DENTAL);
    expect(r.useAdminPath).toBe(true);
    expect(r.requiresTriageRag).toBe(false);
  });

  test('healthcare_clinic disabled uses admin_clinic', () => {
    const r = resolveVisitCodingPath({
      useCase: 'healthcare_clinic',
      triagePolicy: TriagePolicy.DISABLED,
      visitReason: 'follow up appointment'
    });
    expect(r.path).toBe(CODING_PATH.ADMIN_CLINIC);
    expect(r.useAdminPath).toBe(true);
  });

  test('dermatology required uses rag', () => {
    const r = resolveVisitCodingPath({
      useCase: 'dermatology',
      triagePolicy: TriagePolicy.REQUIRED,
      visitReason: 'rash on arm'
    });
    expect(r.path).toBe(CODING_PATH.RAG);
    expect(r.requiresTriageRag).toBe(true);
  });

  test('conditional with symptoms forces rag', () => {
    expect(shouldForceRagForConditional('chest pain since yesterday')).toBe(true);
    const r = resolveVisitCodingPath({
      useCase: 'healthcare_clinic',
      triagePolicy: TriagePolicy.CONDITIONAL,
      visitReason: 'chest pain since yesterday'
    });
    expect(r.path).toBe(CODING_PATH.RAG);
  });

  test('preventive wellness uses preventive path when not disabled', () => {
    const r = resolveVisitCodingPath({
      useCase: 'healthcare_clinic',
      triagePolicy: TriagePolicy.CONDITIONAL,
      visitReason: 'annual wellness check no symptoms'
    });
    expect(r.path).toBe(CODING_PATH.PREVENTIVE);
  });

  test('validatePayerClassForCollect rejects medical payer on dental tenant', () => {
    const r = validatePayerClassForCollect({
      payerId: 'BCBS_PILOT',
      planId: 'plan_x',
      tenantSpecialty: 'Dental'
    });
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('PAYER_CLASS_MISMATCH');
    expect(r.message).toMatch(/medical plan/i);
  });
});
