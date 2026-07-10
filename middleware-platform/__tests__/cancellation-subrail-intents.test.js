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

  test('defers cancel execution to lookup on first cancel request', async () => {
    const out = await handleCancellationSubrail({
      message: 'I need to cancel my appointment for Thursday.',
      active_subrail_step: 'find_booking',
      flags: {}
    });
    expect(out.state_updates.cancel_find_pending).toBe(true);
    expect(out.state_updates.cancel_pending).toBeUndefined();
    expect(out.state_updates.cancel_confirmed).toBeUndefined();
    expect(out.active_subrail_step).toBe('find_booking');
  });

  test('pivots to reschedule for move-it-to-next-week utterance', async () => {
    const out = await handleCancellationSubrail({
      message: 'Actually, can we just move it to next week instead?',
      active_subrail_step: 'find_booking',
      flags: {}
    });
    expect(out.state_updates.reschedule_pending).toBe(true);
    expect(out.state_updates.cancel_pending).toBe(false);
    expect(out.kelly_lane_hint).toBe('reschedule');
  });

  test('RU-3 fee inquiry advances to cancel_execute', async () => {
    const out = await handleCancellationSubrail({
      message: 'Есть ли штраф за отмену?',
      active_subrail_step: 'find_booking',
      flags: { cancel_find_pending: true }
    });
    expect(out.state_updates.cancel_pending).toBe(true);
    expect(out.state_updates.cancel_fee_inquiry).toBe(true);
    expect(out.kelly_lane_hint).toBe('cancel');
  });
});
