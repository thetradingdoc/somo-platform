'use strict';

const { resolveCallOpeners } = require('../services/call-opener-resolver');
const { runConversationDispatch } = require('../services/conversation-mode/conversation-mode-session');
const { FORBIDDEN_PERSONA_RE, buildPlatformSalesOpener } = require('../services/conversation-mode/rails/somo-sales-inbound-rail');

function assertKellySalesConnect(text) {
  expect(String(text || '')).toMatch(/Kelly/i);
  expect(String(text || '')).not.toMatch(FORBIDDEN_PERSONA_RE);
  expect(String(text || '')).not.toMatch(/Alex from Somo/i);
}

function assertNoForbiddenPersona(text) {
  expect(String(text || '')).not.toMatch(FORBIDDEN_PERSONA_RE);
  expect(String(text || '')).not.toMatch(/Alex from Somo/i);
}

describe('platform sales persona sequence (connect → turn1 → turn2)', () => {
  test('connect opener uses Kelly sales persona without name intake', () => {
    const bundle = resolveCallOpeners({
      settings: {},
      practiceName: 'Somo',
      callType: 'platform_support',
      direction: 'inbound',
      routingWorld: 'platform_support'
    });
    expect(bundle.activeOpener.asksName).toBe(false);
    expect(bundle.inbound.asksName).toBe(false);
    expect(bundle.activeOpener.text).toBe(buildPlatformSalesOpener());
    assertKellySalesConnect(bundle.activeOpener.text);
    expect(bundle.activeOpener.text).toMatch(/practice/i);
  });

  test('turn1 and turn2 stay on platform sales rail without persona leaks', async () => {
    const sessionId = `plat_seq_${Date.now()}`;
    const turn1 = await runConversationDispatch({
      sessionId,
      message: 'We are a dental practice',
      call_type: 'platform_support',
      direction: 'inbound',
      routing_world: 'platform_support',
      opener_delivered: true,
      platform_stage: 'practice_type'
    });
    assertNoForbiddenPersona(turn1.dispatch.reply);
    expect(turn1.dispatch.conversation_mode).toBe('platform_support');
    expect(turn1.handoff).toBe('script_only');

    const turn2 = await runConversationDispatch({
      sessionId,
      message: 'We miss a lot of calls after hours',
      call_type: 'platform_support',
      direction: 'inbound',
      routing_world: 'platform_support',
      opener_delivered: true,
      platform_stage: turn1.dispatch.platform_stage || 'pain'
    });
    assertNoForbiddenPersona(turn2.dispatch.reply);
    expect(turn2.dispatch.conversation_mode).toBe('platform_support');
  });
});
