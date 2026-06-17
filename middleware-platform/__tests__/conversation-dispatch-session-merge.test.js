'use strict';

process.env.CONVERSATION_MODE_ROUTING = 'enforce';
process.env.KELLY_RAILS_V2 = '1';

const { runConversationDispatch } = require('../services/conversation-mode/conversation-mode-session');
const { Handoff } = require('../services/conversation-mode/handoff-types');

describe('conversation dispatch session merge', () => {
  test('returns merged session after subrail state_updates', async () => {
    const sessionId = `test_merge_${Date.now()}`;
    const db = require('../database');

    const first = await runConversationDispatch({
      sessionId,
      db,
      clinicId: 'clinic-default',
      call_type: 'tenant',
      direction: 'inbound',
      message: 'I am calling about my appointment',
      utterance: 'I am calling about my appointment'
    });

    expect(first.handoff).toBeDefined();
    expect(first.session.active_subrail_step).toBeTruthy();

    const second = await runConversationDispatch({
      sessionId,
      db,
      clinicId: 'clinic-default',
      call_type: 'tenant',
      direction: 'inbound',
      message: 'Can you confirm the date?',
      utterance: 'Can you confirm the date?',
      appt_lookup_only: true
    });

    expect(second.session).toBeDefined();
    expect(
      second.needs_kelly === true ||
        second.handoff === Handoff.KELLY_REQUIRED ||
        second.handoff === Handoff.KELLY_OPTIONAL
    ).toBe(true);
  });
});
