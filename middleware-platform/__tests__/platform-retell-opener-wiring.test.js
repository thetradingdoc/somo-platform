'use strict';

const { resolveCallOpeners, buildDefaultInboundGreeting } = require('../services/call-opener-resolver');

describe('retell platform_support opener wiring (resolver contract)', () => {
  test('platform_support routingWorld skips front-desk default greeting', () => {
    const platform = resolveCallOpeners({
      settings: {},
      practiceName: 'Somo',
      callType: 'inbound_tenant',
      direction: 'inbound',
      routingWorld: 'platform_support'
    });
    const tenantDefault = resolveCallOpeners({
      settings: {},
      practiceName: 'Somo',
      callType: 'inbound_tenant',
      direction: 'inbound'
    });
    expect(platform.activeOpener.text).not.toBe(buildDefaultInboundGreeting('Somo', 'warm'));
    expect(platform.activeOpener.text).not.toMatch(/front desk receptionist/i);
    expect(platform.activeOpener.asksName).toBe(false);
    expect(tenantDefault.activeOpener.asksName).toBe(true);
    expect(platform.inbound.source).toBe('platform_sales');
  });

  test('callType platform_support forces sales opener', () => {
    const bundle = resolveCallOpeners({
      callType: 'platform_support',
      direction: 'inbound',
      routingWorld: 'platform_support'
    });
    expect(bundle.activeOpener.asksName).toBe(false);
    expect(bundle.activeOpener.text).toMatch(/Kelly with Somo/i);
  });
});
