'use strict';

const { resolveConversationMode } = require('../services/conversation-mode/conversation-mode-resolver');
const { Subrail } = require('../services/conversation-mode/conversation-mode-types');

describe('R-02-6 site_context_status fail-closed', () => {
  test('tenant inbound with ambiguous site fails closed to handoff', () => {
    const out = resolveConversationMode({
      call_type: 'tenant',
      direction: 'inbound',
      tenantPolicy: {},
      tenantResolved: true,
      routing_world: 'tenant',
      site_context_status: 'ambiguous'
    });
    expect(out.fail_closed).toBe(true);
    expect(out.subrail).toBe(Subrail.HANDOFF);
    expect(out.reason).toBe('site_context_ambiguous');
  });

  test('tenant inbound with missing site fails closed', () => {
    const out = resolveConversationMode({
      call_type: 'tenant',
      direction: 'inbound',
      tenantPolicy: {},
      tenantResolved: true,
      routing_world: 'tenant',
      site_context_status: 'missing'
    });
    expect(out.fail_closed).toBe(true);
    expect(out.subrail).toBe(Subrail.HANDOFF);
  });

  test('verified site does not fail closed at mode seed', () => {
    const out = resolveConversationMode({
      call_type: 'tenant',
      direction: 'inbound',
      tenantPolicy: {},
      tenantResolved: true,
      routing_world: 'tenant',
      site_context_status: 'verified'
    });
    expect(out.fail_closed).toBeFalsy();
  });
});
