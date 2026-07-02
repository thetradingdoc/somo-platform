'use strict';

const { isOutboundCallType, resolveCallOpeners } = require('../services/call-opener-resolver');

describe('call opener runtime separation', () => {
  test('inbound and outbound active openers differ with defaults', () => {
    const settings = {
      outbound_enabled: true,
      tone_preset: 'warm'
    };
    const inbound = resolveCallOpeners({
      settings,
      practiceName: 'Test Clinic',
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    const outbound = resolveCallOpeners({
      settings,
      practiceName: 'Test Clinic',
      callType: 'operator_outbound',
      direction: 'outbound'
    });
    expect(inbound.activeOpener.text).toContain('Thank you for calling');
    expect(outbound.activeOpener.text).toContain('good time');
    expect(inbound.activeOpener.text).not.toEqual(outbound.activeOpener.text);
  });

  test('isOutboundCallType covers operator_outbound', () => {
    expect(isOutboundCallType('operator_outbound')).toBe(true);
    expect(isOutboundCallType('inbound_tenant')).toBe(false);
  });

  test('warm_confident tone resolves a branded, name-first inbound opener', () => {
    const inbound = resolveCallOpeners({
      settings: { tone_preset: 'warm_confident' },
      practiceName: 'Test Clinic',
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(inbound.activeOpener.text).toContain('Test Clinic');
    expect(inbound.activeOpener.text).toMatch(/your name/i);
    expect(inbound.activeOpener.text).not.toMatch(/Somo/i);
  });
});
