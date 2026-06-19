'use strict';

jest.mock('../services/somo-demo-template-registry', () => ({
  isDemoTwilioNumber: jest.fn((n) => n === '+13639990205')
}));

const {
  resolveRoutingWorld,
  isTenantResolvedForMode,
  shouldBlockKellyTurn
} = require('../services/voice-routing-world');

describe('voice-routing-world', () => {
  test('demo line without call_type metadata resolves to demo', () => {
    expect(
      resolveRoutingWorld({
        call_type: null,
        direction: 'inbound',
        to_number: '+13639990205',
        customer_id: null
      })
    ).toBe('demo');
  });

  test('tenant requires customer_id for mode resolution', () => {
    expect(isTenantResolvedForMode(null)).toBe(false);
    expect(isTenantResolvedForMode('cust-123')).toBe(true);
    expect(isTenantResolvedForMode('')).toBe(false);
  });

  test('shouldBlockKellyTurn blocks demo and unidentified', () => {
    expect(shouldBlockKellyTurn('demo')).toBe(true);
    expect(shouldBlockKellyTurn('unidentified')).toBe(true);
    expect(shouldBlockKellyTurn('tenant')).toBe(false);
  });
});
