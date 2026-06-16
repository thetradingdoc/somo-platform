'use strict';

const {
  resolveCallOpeners,
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  isLegacyGenericGreeting,
  sanitizePracticeName
} = require('../services/call-opener-resolver');

describe('call-opener-resolver', () => {
  test('buildDefaultInboundGreeting uses Kelly and practice name', () => {
    const text = buildDefaultInboundGreeting('Bright Path Clinic', 'warm');
    expect(text).toContain('Kelly');
    expect(text).toContain('Bright Path Clinic');
    expect(text).toContain('Thank you for calling');
  });

  test('buildDefaultOutboundOpener differs from inbound', () => {
    const inbound = buildDefaultInboundGreeting('Bright Path Clinic');
    const outbound = buildDefaultOutboundOpener('Bright Path Clinic');
    expect(outbound).not.toContain('Thank you for calling');
    expect(outbound).toContain('good time');
    expect(inbound).not.toEqual(outbound);
  });

  test('resolveCallOpeners uses tenant inbound greeting for inbound calls', () => {
    const result = resolveCallOpeners({
      settings: { greeting: 'Custom inbound hello' },
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(result.activeOpener.direction).toBe('inbound');
    expect(result.activeOpener.text).toBe('Custom inbound hello');
  });

  test('resolveCallOpeners uses outbound opener for outbound calls', () => {
    const result = resolveCallOpeners({
      settings: {
        greeting: 'Custom inbound hello',
        outbound_opener: 'Custom outbound hello',
        outbound_enabled: true
      },
      callType: 'operator_outbound',
      direction: 'outbound'
    });
    expect(result.activeOpener.direction).toBe('outbound');
    expect(result.activeOpener.text).toBe('Custom outbound hello');
  });

  test('operator_outbound still gets opener when tenant outbound_enabled is false', () => {
    const result = resolveCallOpeners({
      settings: { outbound_enabled: false },
      callType: 'operator_outbound',
      direction: 'outbound'
    });
    expect(result.outbound.enabled).toBe(true);
    expect(result.outbound.text).toMatch(/Kelly/i);
    expect(result.activeOpener.direction).toBe('outbound');
  });

  test('tenant outbound disabled returns null outbound text for generic outbound type', () => {
    const result = resolveCallOpeners({
      settings: { outbound_enabled: false },
      callType: 'outbound',
      direction: 'outbound'
    });
    expect(result.outbound.enabled).toBe(false);
    expect(result.outbound.text).toBeNull();
  });

  test('sanitizePracticeName rejects bad values', () => {
    expect(sanitizePracticeName('Somo owner')).toBeNull();
    expect(sanitizePracticeName('Real Clinic')).toBe('Real Clinic');
  });

  test('isLegacyGenericGreeting detects old template', () => {
    expect(isLegacyGenericGreeting("Hi, you've reached X. I'm Kelly, your AI front desk.")).toBe(true);
    expect(isLegacyGenericGreeting('Hi, I am Kelly from Somo')).toBe(false);
  });
});
