'use strict';

const { handleCancellationSubrail } = require('../services/conversation-mode/subrails/cancellation-subrail');

describe('cancellation subrail intents', () => {
  test('emits cancel_intents on cancel request', async () => {
    const out = await handleCancellationSubrail({
      message: 'I need to cancel my appointment',
      active_subrail_step: 'find_booking',
      flags: {}
    });
    expect(out.state_updates.cancel_intents).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'cancel_requested' })])
    );
  });
});
