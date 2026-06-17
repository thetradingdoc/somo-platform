'use strict';

const {
  detectBookingIntents,
  applyBookingIntentsToFlags,
  planTurnOwner,
  BookingIntentType
} = require('../services/kelly-rails/turn-planner');

describe('turn-planner', () => {
  test('detectBookingIntents parses time and provider', () => {
    const intents = detectBookingIntents('12:00 with Dr. Maria Santos works for me', 'slot_select');
    expect(intents.some((i) => i.type === BookingIntentType.SLOT_SELECTED && i.time === '12:00')).toBe(true);
    expect(intents.some((i) => i.type === BookingIntentType.PROVIDER_NAMED)).toBe(true);
  });

  test('applyBookingIntentsToFlags does not write current_booking_slot', () => {
    const flags = {};
    applyBookingIntentsToFlags(flags, [
      { type: BookingIntentType.SLOT_SELECTED, time: '12:00' },
      { type: BookingIntentType.PROVIDER_NAMED, provider: 'Maria Santos' }
    ]);
    expect(flags._slot_selected_time).toBe('12:00');
    expect(flags.provider_preference).toBe('Maria Santos');
    expect(flags.current_booking_slot).toBeUndefined();
  });

  test('planTurnOwner routes confirm with slot to schedule gate', () => {
    const plan = planTurnOwner({
      subrail: 'booking',
      flags: { _slot_selected_time: '12:00' },
      intents: [{ type: BookingIntentType.CONFIRM_BOOK }]
    });
    expect(plan.owner).toBe('gate');
    expect(plan.gateId).toBe('schedule');
  });
});
