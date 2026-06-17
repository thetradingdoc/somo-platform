'use strict';

const { handleHandoffSubrail, HANDOFF_RETRY_CEILING } = require('../services/conversation-mode/subrails/handoff-subrail');

describe('handoff failure recovery', () => {
  test('retries once then exhausts on repeated failure', async () => {
    const first = await handleHandoffSubrail({
      sessionId: 'sess_handoff',
      handoff_step: 'attempt',
      handoff_retry_count: 0,
      message: 'they are unavailable'
    });
    expect(first.handoff_retry_count).toBe(1);
    expect(first.disposition).toBe('handoff_failed');
    expect(first.reply).toMatch(/callback/i);

    const second = await handleHandoffSubrail({
      sessionId: 'sess_handoff',
      handoff_step: 'failed_retry',
      handoff_retry_count: 1,
      message: 'still unavailable'
    });
    expect(second.handoff_retry_count).toBe(2);
    expect(second.state_updates.handoff_exhausted).toBe(true);
    expect(HANDOFF_RETRY_CEILING).toBe(2);
  });
});
