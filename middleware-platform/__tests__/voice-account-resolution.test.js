'use strict';

const {
  getOperatorCustomerId,
  resolveCustomerIdForBilling,
  resolveVoiceAccount,
  isOutboundRequest,
  normalizeCallType
} = require('../services/voice-account-resolution');

describe('voice-account-resolution', () => {
  it('getOperatorCustomerId prefers CALLSOMO_OPERATOR_CUSTOMER_ID', () => {
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID = 'cust_op';
    process.env.CALLSOMO_VOICE_CUSTOMER_ID = 'cust_voice';
    expect(getOperatorCustomerId()).toBe('cust_op');
    delete process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
    expect(getOperatorCustomerId()).toBe('cust_voice');
    delete process.env.CALLSOMO_VOICE_CUSTOMER_ID;
  });

  it('resolveCustomerIdForBilling rejects invalid clinic_id fallback', () => {
    const db = {
      getCustomer: (id) => (id === 'cust_real' ? { id } : null),
      getCustomerIdForClinic: () => 'cust_real'
    };
    const customerId = resolveCustomerIdForBilling(db, {
      clinic_id: 'lead_123',
      customer_id: null
    });
    expect(customerId).toBe('cust_real');
  });

  it('normalizeCallType sets operator_outbound default', () => {
    const req = { query: {} };
    expect(
      normalizeCallType(req, { isOutbound: true, isSomoDemoDemo: false, leadId: null })
    ).toBe('operator_outbound');
  });

  it('isOutboundRequest detects operator_outbound', () => {
    const req = { query: { call_type: 'operator_outbound' }, body: {} };
    expect(isOutboundRequest(req, false)).toBe(true);
  });

  const mockDb = (overrides = {}) => ({
    getCustomer: (id) => (id === 'cust_op' ? { id, merchant_id: 'm1' } : null),
    getCustomerByTwilioNumber: (n) =>
      n === '+13639990205' ? { id: 'cust_by_phone', twilio_phone_number: n } : null,
    getClinicPhoneNumber: () => null,
    getCustomerIdForClinic: () => null,
    db: { prepare: () => ({ get: () => null }) },
    ...overrides
  });

  it('path A resolves customer_id from URL query param', () => {
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID = 'cust_other';
    const db = mockDb();
    const req = { query: { customer_id: 'cust_op' }, headers: {} };
    const result = resolveVoiceAccount(db, req, {
      normalizedToNumber: '+13639990205',
      isSomoDemoDemo: false,
      isOutbound: true,
      leadId: null
    });
    expect(result.customerId).toBe('cust_op');
    delete process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
  });

  it('path B resolves customer via To number on inbound', () => {
    const db = mockDb();
    const req = { query: {}, headers: {} };
    const result = resolveVoiceAccount(db, req, {
      normalizedToNumber: '+13639990205',
      isSomoDemoDemo: false,
      isOutbound: false,
      leadId: null
    });
    expect(result.customerId).toBe('cust_by_phone');
  });

  it('path C resolves operator env fallback on outbound without customer_id', () => {
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID = 'cust_op';
    const db = mockDb();
    const req = { query: { call_type: 'operator_outbound' }, body: {}, headers: {} };
    const result = resolveVoiceAccount(db, req, {
      normalizedToNumber: '+13639990205',
      isSomoDemoDemo: false,
      isOutbound: true,
      leadId: null
    });
    expect(result.customerId).toBe('cust_op');
    delete process.env.CALLSOMO_OPERATOR_CUSTOMER_ID;
  });
});
