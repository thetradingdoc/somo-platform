'use strict';

const { mergeConversationStateUpdates } = require('../services/kelly-rails/session-ssot');

jest.mock('../database', () => {
  const runs = [];
  return {
    db: {
      transaction: (fn) => () => fn(),
      prepare: () => ({
        run: (...args) => runs.push(args)
      })
    },
    __runs: runs
  };
});

jest.mock('../services/kelly-tool-executor', () => ({
  _setSessionMeta: jest.fn(),
  _getSessionMeta: jest.fn()
}));

describe('mergeConversationStateUpdates', () => {
  test('strips current_booking_slot from L2 dispatch updates', () => {
    const merged = mergeConversationStateUpdates(
      'sess_merge',
      { conversation_mode: 'tenant_inbound_admin' },
      {
        current_booking_slot: { time: '12:00', date: '2026-07-01' },
        booking_intents: [{ type: 'slot_selected', time: '12:00' }]
      }
    );
    expect(merged.current_booking_slot).toBeUndefined();
    expect(merged.booking_intents).toHaveLength(1);
  });
});
