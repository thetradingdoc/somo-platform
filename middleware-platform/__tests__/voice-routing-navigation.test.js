'use strict';

const {
  ROUTING_WORLD_NAVIGATION,
  resolveRoutingWorld,
} = require('../services/voice-routing-world');
const { CALL_TYPE_CONSUMER_NAVIGATION } = require('../services/voice-call-context');

describe('voice routing navigation contracts (P0-S3)', () => {
  test('ROUTING_WORLD_NAVIGATION constant is navigation', () => {
    expect(ROUTING_WORLD_NAVIGATION).toBe('navigation');
  });

  test('CALL_TYPE_CONSUMER_NAVIGATION constant is consumer_navigation', () => {
    expect(CALL_TYPE_CONSUMER_NAVIGATION).toBe('consumer_navigation');
  });

  test('resolveRoutingWorld maps navigation customer to navigation world', () => {
    expect(
      resolveRoutingWorld({
        call_type: CALL_TYPE_CONSUMER_NAVIGATION,
        direction: 'inbound',
        to_number: '+18623622415',
        customer_id: 'cust-navigation-demo',
        customer: { customer_type: 'navigation' },
      })
    ).toBe('navigation');
  });

  test('shouldBlockKellyTurn blocks navigation', () => {
    const { shouldBlockKellyTurn } = require('../services/voice-routing-world');
    expect(shouldBlockKellyTurn('navigation')).toBe(true);
  });
});
