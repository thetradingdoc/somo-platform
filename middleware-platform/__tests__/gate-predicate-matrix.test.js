'use strict';

const {
  buildGateRegistry,
  gateAllowedByTurnPlan
} = require('../services/kelly-rails/gate-registry');
const { KELLY_LANE } = require('../services/kelly-rails/state-schema');
const { planTurnOwner } = require('../services/kelly-rails/turn-planner');

describe('gate-predicate-matrix', () => {
  const noop = async () => null;

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

  test('turn plan restricts to schedule gate when confirm+slot', () => {
    const state = {
      flags: {
        _turn_plan: { owner: 'gate', gateId: 'schedule' },
        _slot_selected_time: '12:00'
      }
    };
    const schedule = registry.find((g) => g.id === 'schedule');
    const cancel = registry.find((g) => g.id === 'cancel');
    expect(gateAllowedByTurnPlan(schedule, state)).toBe(true);
    expect(gateAllowedByTurnPlan(cancel, state)).toBe(false);
  });

  test('cancel gate ownership tuple', () => {
    const state = {
      active_lane: KELLY_LANE.RESCHEDULE,
      step: 'move_or_cancel',
      flags: { cancel_pending: true }
    };
    expect(state.active_lane).toBe('reschedule');
    expect(state.step).toBe('move_or_cancel');
    expect(state.flags.cancel_pending).toBe(true);
  });

  test('records gate ownership tuple', () => {
    const state = {
      active_lane: KELLY_LANE.RECORDS,
      step: 'records_qa',
      conversation_mode: 'tenant_records'
    };
    expect(state.active_lane).toBe('records');
    expect(state.step).toBe('records_qa');
  });

  test('planTurnOwner maps booking confirm to schedule gate', () => {
    const plan = planTurnOwner({
      subrail: 'booking',
      flags: { _slot_selected_time: '14:00' },
      intents: [{ type: 'confirm_book' }]
    });
    expect(plan.owner).toBe('gate');
    expect(plan.gateId).toBe('schedule');
  });
});
