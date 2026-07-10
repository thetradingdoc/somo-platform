'use strict';

jest.mock('../services/navigation/navigation-config', () => ({
  isNavigationEnabled: jest.fn(() => true),
  navigationDid: jest.fn(() => '+13639990205'),
  isPlatformNavigationDid: jest.fn((n) => n === '+13639990205')
}));

const {
  resolveRoutingWorld,
  isTenantResolvedForMode,
  shouldBlockKellyTurn
} = require('../services/voice-routing-world');

describe('voice-routing-world', () => {
  test('platform DID with navigation customer resolves to navigation', () => {
    expect(
      resolveRoutingWorld({
        call_type: 'consumer_navigation',
        direction: 'inbound',
        to_number: '+13639990205',
        customer_id: 'cust-navigation-demo',
        customer: { customer_type: 'navigation' }
      })
    ).toBe('navigation');
  });

  test('unknown inbound without customer resolves to unidentified', () => {
    expect(
      resolveRoutingWorld({
        call_type: null,
        direction: 'inbound',
        to_number: '+15551234567',
        customer_id: null
      })
    ).toBe('unidentified');
  });

  test('tenant requires customer_id or clinic for mode resolution', () => {
    expect(isTenantResolvedForMode(null)).toBe(false);
    expect(isTenantResolvedForMode('cust-123')).toBe(true);
    expect(isTenantResolvedForMode('')).toBe(false);
    expect(
      isTenantResolvedForMode({
        clinicId: 'clinic-1',
        db: { getCustomerIdForClinic: () => 'cust-1', getClinic: () => ({ clinic_id: 'clinic-1' }) }
      })
    ).toBe(true);
  });

  test('shouldBlockKellyTurn blocks navigation, platform_support, and unidentified', () => {
    expect(shouldBlockKellyTurn('navigation')).toBe(true);
    expect(shouldBlockKellyTurn('platform_support')).toBe(true);
    expect(shouldBlockKellyTurn('unidentified')).toBe(true);
    expect(shouldBlockKellyTurn('tenant')).toBe(false);
  });

  test('operator customer on platform DID resolves to platform_support', () => {
    expect(
      resolveRoutingWorld({
        call_type: 'platform_support',
        direction: 'inbound',
        to_number: '+13639990205',
        customer_id: 'cust-operator',
        customer: { customer_type: 'operator' }
      })
    ).toBe('platform_support');
  });

  test('navigation customer resolves to navigation world', () => {
    expect(
      resolveRoutingWorld({
        call_type: 'consumer_navigation',
        direction: 'inbound',
        to_number: '+18623622415',
        customer_id: 'cust-navigation-demo',
        customer: { customer_type: 'navigation' }
      })
    ).toBe('navigation');
  });
});
