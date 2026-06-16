'use strict';

const {
  isConversationModeRoutingEnforced,
  isConversationModeRoutingShadow,
  shouldEnforceMode
} = require('../services/conversation-mode/config');

describe('conversation mode staged enforce config', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  test('default is shadow routing', () => {
    delete process.env.CONVERSATION_MODE_ROUTING;
    expect(isConversationModeRoutingShadow()).toBe(true);
    expect(isConversationModeRoutingEnforced()).toBe(false);
  });

  test('global enforce enables all modes', () => {
    process.env.CONVERSATION_MODE_ROUTING = 'enforce';
    expect(shouldEnforceMode('tenant_inbound_admin')).toBe(true);
    expect(shouldEnforceMode('operator_outbound')).toBe(true);
  });

  test('staged prod: shadow global + per-mode operator outbound', () => {
    process.env.CONVERSATION_MODE_ROUTING = 'shadow';
    process.env.CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND = 'true';
    process.env.CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES = '1';
    delete process.env.CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN;

    expect(isConversationModeRoutingShadow()).toBe(true);
    expect(shouldEnforceMode('operator_outbound')).toBe(true);
    expect(shouldEnforceMode('outbound_sales')).toBe(true);
    expect(shouldEnforceMode('tenant_inbound_admin')).toBe(false);
    expect(shouldEnforceMode('tenant_inbound_clinical')).toBe(false);
  });
});
