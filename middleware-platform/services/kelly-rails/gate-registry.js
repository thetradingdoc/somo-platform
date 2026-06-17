'use strict';

const { KELLY_LANE } = require('./state-schema');
const { getDeterministicReply } = require('./prompts/deterministic');

/**
 * Gate registry — explicit priority ordering for deterministic L4 gates.
 * Schedule (90) runs before conflict (80) when both could match.
 */
function buildGateRegistry(runners) {
  return [
    { id: 'safety', priority: 100, run: runners.runDeterministicSafety, owns: (r) => !!r },
    {
      id: 'post_payment',
      priority: 99,
      run: runners.runDeterministicPostPaymentConfirmation,
      owns: (r) => !!r
    },
    { id: 'payment', priority: 98, run: runners.runDeterministicPayment, owns: (r) => !!r },
    { id: 'records', priority: 97, run: runners.runDeterministicRecords, owns: (r) => r && !!r.reply },
    {
      id: 'lookup',
      priority: 96,
      run: runners.runDeterministicApptLookup,
      owns: (r) => r && !!r.reply
    },
    { id: 'reschedule', priority: 95, run: runners.runDeterministicReschedule, owns: (r) => !!r },
    { id: 'cancel', priority: 94, run: runners.runDeterministicCancel, owns: (r) => !!r },
    {
      id: 'clinical_intro',
      priority: 93,
      run: runners.runDeterministicClinicalIntro,
      owns: (r) => r && !!r.reply
    },
    { id: 'opqrst', priority: 92, run: runners.runDeterministicOpqrst, owns: (r) => r && !!r.reply },
    {
      id: 'schedule',
      priority: 90,
      run: runners.runDeterministicSchedule,
      owns: (r) => r && !!r.reply
    },
    {
      id: 'conflict',
      priority: 80,
      predicate: (state) =>
        state.flags?.booking_conflict ||
        state.flags?.provider_mismatch ||
        (Array.isArray(state.flags?._conflict_slot_bundles) &&
          state.flags._conflict_slot_bundles.length > 0),
      run: runners.runDeterministicBookingConflict,
      owns: (r) => !!r
    }
  ];
}

function sortGatesByPriority(registry) {
  return [...registry].sort((a, b) => b.priority - a.priority);
}

/**
 * Run pre-booking gates (everything before schedule/conflict block).
 */
async function runPreBookingGates(registry, state, ctx, advanceAfterStep) {
  const preIds = new Set([
    'safety',
    'post_payment',
    'payment',
    'records',
    'lookup',
    'reschedule',
    'cancel',
    'clinical_intro',
    'opqrst'
  ]);
  const sorted = sortGatesByPriority(registry).filter((g) => preIds.has(g.id));

  for (const gate of sorted) {
    const result = await gate.run(state, ctx);
    if (gate.owns(result)) {
      advanceAfterStep(state, result.toolsUsed || []);
      return { gateId: gate.id, result };
    }
  }
  return null;
}

/**
 * Run schedule then conflict gates (booking-critical ordering).
 */
async function runBookingGates(registry, state, ctx, advanceAfterStep) {
  const scheduleGate = registry.find((g) => g.id === 'schedule');
  const conflictGate = registry.find((g) => g.id === 'conflict');

  if (scheduleGate) {
    const detSched = await scheduleGate.run(state, ctx);
    if (scheduleGate.owns(detSched)) {
      advanceAfterStep(state, detSched.toolsUsed || []);
      return { gateId: 'schedule', result: detSched };
    }
  }

  const conflictPending = conflictGate?.predicate?.(state);
  if (conflictPending && conflictGate) {
    const detConflict = await conflictGate.run(state, ctx);
    if (conflictGate.owns(detConflict)) {
      advanceAfterStep(state, detConflict.toolsUsed || []);
      return { gateId: 'conflict', result: detConflict };
    }
  }

  if (conflictGate) {
    const detConflictRetry = await conflictGate.run(state, ctx);
    if (conflictGate.owns(detConflictRetry)) {
      advanceAfterStep(state, detConflictRetry.toolsUsed || []);
      return { gateId: 'conflict', result: detConflictRetry };
    }
  }

  return null;
}

function shouldSkipLlm(state) {
  const cancelGateActive =
    state.active_lane === KELLY_LANE.RESCHEDULE &&
    state.step === 'move_or_cancel' &&
    (state.flags?.cancel_pending || state.flags?.reschedule_pending);
  const recordsGateActive = state.active_lane === KELLY_LANE.RECORDS && state.step === 'records_qa';
  const conflictGateActive =
    state.active_lane === KELLY_LANE.BOOKING &&
    (state.flags?.booking_conflict || state.flags?.provider_mismatch) &&
    (state.step === 'schedule_visit' || state.step === 'confirm_visit');

  return (
    (state.flags?.appt_lookup_only &&
      state.active_lane === KELLY_LANE.RESCHEDULE &&
      state.step === 'find_booking') ||
    (state.flags?.cancel_find_pending &&
      state.active_lane === KELLY_LANE.RESCHEDULE &&
      state.step === 'find_booking') ||
    (state.active_lane === KELLY_LANE.BOOKING && state.step === 'confirm_visit') ||
    conflictGateActive ||
    cancelGateActive ||
    recordsGateActive
  );
}

function skipLlmReply(state) {
  return {
    reply: state.flags?.lookup_complete
      ? getDeterministicReply('slots_offered', state.locale || 'en')
      : getDeterministicReply('gate_processing', state.locale || 'en'),
    toolsUsed: [],
    endCall: false
  };
}

module.exports = {
  buildGateRegistry,
  sortGatesByPriority,
  runPreBookingGates,
  runBookingGates,
  shouldSkipLlm,
  skipLlmReply
};
