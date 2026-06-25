'use strict';

const handler = require('../webhooks/consumer-navigation-handler');

describe('consumer-navigation-handler', () => {
  test('isNavigationConnection detects routing_world navigation', () => {
    const connection = { routing_world: 'navigation', conversationHistory: [] };
    expect(handler.isNavigationConnection(connection)).toBe(true);
    expect(connection._isNavigationConnection).toBe(true);
  });

  test('isNavigationConnection false when NAVIGATION_ENABLED=0', () => {
    const prev = process.env.NAVIGATION_ENABLED;
    process.env.NAVIGATION_ENABLED = '0';
    const connection = { routing_world: 'navigation', conversationHistory: [] };
    connection._isNavigationConnection = undefined;
    expect(handler.isNavigationConnection(connection)).toBe(false);
    process.env.NAVIGATION_ENABLED = prev;
  });

  test('NAVIGATION_GREETING is need-first', () => {
    expect(handler.NAVIGATION_GREETING).toMatch(/how can i help/i);
    expect(handler.NAVIGATION_GREETING).not.toMatch(/health plan/i);
  });
});
