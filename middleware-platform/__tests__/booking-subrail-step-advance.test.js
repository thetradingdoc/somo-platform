'use strict';

const { resolveNextBookingStep, BOOKING_STEPS } = require('../services/conversation-mode/subrails/booking-subrail');
const { BookingIntentType } = require('../services/kelly-rails/turn-planner');

describe('booking-subrail step advance', () => {
  test('Kelly-owned steps hold position without L4 signal', () => {
    const next = resolveNextBookingStep('slot_lookup', { flags: {}, message: 'hello' }, []);
    expect(next).toBe('slot_lookup');
  });

  test('advances to confirm when schedule succeeded', () => {
    const next = resolveNextBookingStep('schedule', { flags: { schedule_appointment_success: true } }, []);
    expect(next).toBe('confirm');
  });

  test('intent_confirm advances to slot_lookup on booking intent', () => {
    const next = resolveNextBookingStep('intent_confirm', { message: 'I need to book' }, []);
    expect(next).toBe('slot_lookup');
  });

  test('slot_select advances on slot_selected intent', () => {
    const next = resolveNextBookingStep(
      'slot_select',
      { flags: {}, message: '12:00 works' },
      [{ type: BookingIntentType.SLOT_SELECTED, time: '12:00' }]
    );
    expect(next).toBe('contact_confirm');
  });

  test('BOOKING_STEPS includes gate-owned phases', () => {
    expect(BOOKING_STEPS).toContain('slot_lookup');
    expect(BOOKING_STEPS).toContain('confirm');
  });
});
