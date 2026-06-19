'use strict';

const {
  resolveCallSiteContext,
  SiteContextStatus,
  ClinicIdSource,
  isSiteContextVerified
} = require('../services/call-site-context');

describe('call-site-context', () => {
  const mockDb = {
    getClinicPhoneNumber: (num) =>
      num === '+15551234567' ? { clinic_id: 'clinic-did' } : null,
    getCustomerIdForClinic: (clinicId) => (clinicId === 'clinic-did' ? 'cust-1' : null),
    getClinicById: (id) => (id === 'clinic-did' ? { id, merchant_id: 'm1' } : null),
    getCustomer: (id) => (id === 'cust-1' ? { id, merchant_id: 'm1' } : null)
  };

  test('demo line → not_required', () => {
    const ctx = resolveCallSiteContext({
      db: mockDb,
      to_number: '+13639990205',
      customer_id: null,
      call_type: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(ctx.site_context_status).toBe(SiteContextStatus.NOT_REQUIRED);
  });

  test('DID match + customer match → verified', () => {
    const ctx = resolveCallSiteContext({
      db: mockDb,
      to_number: '+15551234567',
      customer_id: 'cust-1',
      call_type: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(ctx.site_context_status).toBe(SiteContextStatus.VERIFIED);
    expect(ctx.clinic_id).toBe('clinic-did');
    expect(ctx.clinic_id_source).toBe(ClinicIdSource.DID);
  });

  test('no clinic → missing', () => {
    const ctx = resolveCallSiteContext({
      db: mockDb,
      to_number: '+19998887777',
      customer_id: 'cust-1',
      call_type: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(ctx.site_context_status).toBe(SiteContextStatus.MISSING);
  });

  test('isSiteContextVerified respects not_required', () => {
    expect(
      isSiteContextVerified({ site_context_status: SiteContextStatus.NOT_REQUIRED })
    ).toBe(true);
    expect(isSiteContextVerified({ site_context_status: SiteContextStatus.AMBIGUOUS })).toBe(
      false
    );
  });

  test('operator_outbound → not_required', () => {
    const ctx = resolveCallSiteContext({
      db: mockDb,
      call_type: 'operator_outbound',
      direction: 'outbound'
    });
    expect(ctx.site_context_status).toBe(SiteContextStatus.NOT_REQUIRED);
  });

  test('tenant outbound without clinic → missing (T-012)', () => {
    const ctx = resolveCallSiteContext({
      db: mockDb,
      call_type: 'outbound',
      direction: 'outbound',
      customer_id: 'cust-1'
    });
    expect(ctx.site_context_status).toBe(SiteContextStatus.MISSING);
  });

  test('tenant outbound with clinic metadata → verified', () => {
    const ctx = resolveCallSiteContext({
      db: mockDb,
      call_type: 'outbound',
      direction: 'outbound',
      customer_id: 'cust-1',
      clinic_id: 'clinic-did',
      clinic_id_source: ClinicIdSource.METADATA
    });
    expect(ctx.site_context_status).toBe(SiteContextStatus.VERIFIED);
  });
});
