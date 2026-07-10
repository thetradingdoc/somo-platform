'use strict';

process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const { dispatchConversationTurn } = require('../services/conversation-mode/conversation-dispatcher');
const { ConversationMode } = require('../services/conversation-mode/conversation-mode-types');
const { Handoff } = require('../services/conversation-mode/handoff-types');
const { resolveConversationMode } = require('../services/conversation-mode/conversation-mode-resolver');

describe('demo_qual dispatch regression', () => {
  test('somo_demo resolves to platform_support', () => {
    const resolved = resolveConversationMode({
      call_type: 'somo_demo',
      direction: 'inbound',
      tenantResolved: true,
      routing_world: 'tenant'
    });
    expect(resolved.mode).toBe(ConversationMode.PLATFORM_SUPPORT);
  });

  test('enforced demo_qual dispatch is SCRIPT_ONLY without booking hint', async () => {
    const out = await dispatchConversationTurn(ConversationMode.DEMO_QUAL, {
      message: 'Tell me about Somo',
      opener_delivered: true,
      platform_stage: 'practice_type'
    });
    expect(out.handoff).toBe(Handoff.SCRIPT_ONLY);
    expect(out.kelly_lane_hint).not.toBe('booking');
    expect(out.conversation_mode).toBe(ConversationMode.PLATFORM_SUPPORT);
    expect(out.reply).toMatch(/practice|challenge|Somo|demo|signup/i);
  });
});
