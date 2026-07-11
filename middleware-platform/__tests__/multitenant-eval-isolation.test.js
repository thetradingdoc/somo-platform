'use strict';

/**
 * MT-08 — Multitenant eval isolation (clinic-a vs clinic-b fixture profiles).
 */

const client = require('../services/layer2-rag/pinecone-code-metadata-client');
const Metrics = require('../services/metrics');
const {
  resolveAdminVisitCodes,
  CLINIC_STARTER_SET_MAP
} = require('../services/resolve-admin-visit-codes');

describe('multitenant eval isolation (MT-08)', () => {
  test('fixture defines clinic-a and clinic-b starter profiles', () => {
    expect(CLINIC_STARTER_SET_MAP['clinic-a']).toMatchObject({
      tenantSpecialty: 'Dental',
      profile: 'dental_pilot'
    });
    expect(CLINIC_STARTER_SET_MAP['clinic-b']).toMatchObject({
      tenantSpecialty: 'healthcare_clinic',
      profile: 'primary_care'
    });
  });

  test('clinic-a resolves dental cleaning; clinic-b resolves primary care annual', () => {
    const dental = resolveAdminVisitCodes('dental cleaning', 'Dental', { clinicId: 'clinic-a' });
    expect(dental.ok).toBe(true);
    expect(dental.primary_cpt).toBe('D1110');

    const primary = resolveAdminVisitCodes('annual checkup', 'healthcare_clinic', { clinicId: 'clinic-b' });
    expect(primary.ok).toBe(true);
    expect(primary.primary_cpt).toBe('99395');
    expect(primary.clinic_profile).toBe('primary_care');
  });

  test('clinic-b extra trigger resolves psych intake to 90791', () => {
    const r = resolveAdminVisitCodes('psych intake', 'healthcare_clinic', { clinicId: 'clinic-b' });
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('90791');
  });

  test('resolveAdminInsuranceCodes stays scoped per clinic profile', () => {
    const a = resolveAdminVisitCodes('cleaning', 'Dental', { clinicId: 'clinic-a' });
    const b = resolveAdminVisitCodes('follow up established patient', 'healthcare_clinic', { clinicId: 'clinic-b' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.primary_cpt).toBe('D1110');
    expect(b.primary_cpt).toBe('99213');
    expect(a.primary_cpt).not.toBe(b.primary_cpt);
  });

  test('Pinecone aggregateFromMatches isolates CPT by clinic_id', () => {
    const matches = [
      { metadata: { cpt_codes: '99214', clinic_id: 'clinic-a' }, score: 0.9 },
      { metadata: { cpt_codes: '99203', clinic_id: 'clinic-b' }, score: 0.92 },
      { metadata: { cpt_codes: '99213' }, score: 0.88 }
    ];
    const forA = client.aggregateFromMatches(matches, 'cpt_codes', 'cpt', 'clinic-a');
    const forB = client.aggregateFromMatches(matches, 'cpt_codes', 'cpt', 'clinic-b');
    expect(forA.map((c) => c.code)).toContain('99214');
    expect(forA.map((c) => c.code)).not.toContain('99203');
    expect(forB.map((c) => c.code)).toContain('99203');
    expect(forB.map((c) => c.code)).not.toContain('99214');
    expect(forA.map((c) => c.code)).toContain('99213');
    expect(forB.map((c) => c.code)).toContain('99213');
  });

  test('pinecone_tenant_filter_reject increments on cross-tenant exclusion', () => {
    Metrics.getAll().counters['pinecone_tenant_filter_reject'] = 0;
    const matches = [
      { metadata: { cpt_codes: '99214', clinic_id: 'clinic_a' }, score: 0.9 },
      { metadata: { cpt_codes: '99213', clinic_id: 'clinic_b' }, score: 0.95 }
    ];
    client.aggregateFromMatches(matches, 'cpt_codes', 'cpt', 'clinic_a');
    expect(Metrics.getAll().counters['pinecone_tenant_filter_reject']).toBeGreaterThan(0);
  });
});
