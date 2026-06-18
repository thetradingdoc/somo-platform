'use strict';

const {
  BookingPhase,
  L4_BOOKING_STEP,
  l2BookingPhaseToL4Step,
  l2CancelPhaseToL4Step,
  GATE_OUTCOME
} = require('../services/kelly-rails/phase-enums');

describe('phase-enums', () => {
  test('l2BookingPhaseToL4Step maps slot_lookup to schedule_visit', () => {
    expect(l2BookingPhaseToL4Step(BookingPhase.SLOT_LOOKUP, {})).toBe(L4_BOOKING_STEP.SCHEDULE_VISIT);
  });

  test('l2BookingPhaseToL4Step maps confirm with slot to confirm_visit', () => {
    expect(
      l2BookingPhaseToL4Step(BookingPhase.CONFIRM, {
        current_booking_slot: { date: '2026-06-10', time: '12:00' }
      })
    ).toBe(L4_BOOKING_STEP.CONFIRM_VISIT);
  });

  test('l2CancelPhaseToL4Step maps cancel_execute to move_or_cancel', () => {
    expect(l2CancelPhaseToL4Step('cancel_execute', {})).toBe('move_or_cancel');
  });

  test('GATE_OUTCOME includes booking lifecycle outcomes', () => {
    expect(GATE_OUTCOME.BOOKED).toBe('booked');
    expect(GATE_OUTCOME.CANCELLED).toBe('cancelled');
    expect(GATE_OUTCOME.RESCHEDULED).toBe('rescheduled');
  });
});
