'use strict';

const {
  buildGateRegistry,
  sortGatesByPriority,
  shouldSkipLlm
} = require('../services/kelly-rails/gate-registry');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');

describe('gate-registry', () => {
  const noop = async () => null;

  test('schedule priority is higher than conflict', () => {
    const registry = buildGateRegistry({
      runDeterministicSafety: noop,
      runDeterministicPostPaymentConfirmation: noop,
      runDeterministicPayment: noop,
      runDeterministicRecords: noop,
      runDeterministicApptLookup: noop,
      runDeterministicReschedule: noop,
      runDeterministicCancel: noop,
      runDeterministicClinicalIntro: noop,
      runDeterministicOpqrst: noop,
      runDeterministicSchedule: noop,
      runDeterministicBookingConflict: noop
    });
    const sorted = sortGatesByPriority(registry);
    const scheduleIdx = sorted.findIndex((g) => g.id === 'schedule');
    const conflictIdx = sorted.findIndex((g) => g.id === 'conflict');
    expect(scheduleIdx).toBeLessThan(conflictIdx);
    expect(sorted[scheduleIdx].priority).toBeGreaterThan(sorted[conflictIdx].priority);
  });

  test('shouldSkipLlm on booking confirm_visit', () => {
    const state = {
      active_lane: KELLY_LANE.BOOKING,
      step: 'confirm_visit',
      flags: {}
    };
    expect(shouldSkipLlm(state)).toBe(true);
  });
});
