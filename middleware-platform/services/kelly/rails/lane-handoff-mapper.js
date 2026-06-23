'use strict';

/**
 * Map L2 handoff (mode, subrail, step, flags) → L4 lane/step.
 * Under enforce, execute-turn must not re-sniff utterances for routing.
 */

const { KELLY_LANE, LANE_FIRST_STEP, PAYMENT_SIGNALS } = require('./state-schema');
const {
  detectBookingIntents,
  detectCancelIntents,
  detectRescheduleIntents,
  detectRecordsIntents,
  applyBookingIntentsToFlags,
  applyCancelIntentsToFlags,
  applyRescheduleIntentsToFlags,
  applyRecordsIntentsToFlags,
  planTurnOwner
} = require('./turn-planner');
const {
  l2BookingPhaseToL4Step,
  l2CancelPhaseToL4Step,
  l2RecordsPhaseToL4Step,
  L4_BOOKING_STEP,
  L4_CANCEL_STEP,
} = require('./phase-enums');
const { enforceHandoffOnlyRouting } = require('./handoff-contract');

function shouldSkipLegacyRouting(state, enforceMode) {
  return enforceHandoffOnlyRouting(enforceMode, { conversation_mode: state.conversation_mode });
}

/**
 * @param {object} state - normalized Kelly rails state (mutated)
 * @param {object} ctx - turn context
 * @param {object} input - executeTurn input
 * @param {{ enforceMode: boolean }} options
 * @returns {{ skipLegacyRouting: boolean, payIntentNow: boolean, onRecordsRail: boolean }}
 */
function applyLaneStepFromL2Handoff(state, ctx, input, options = {}) {
  const enforceMode = !!options.enforceMode;
  const opqrstInProgress = !!options.opqrstInProgress;
  const subrailStep = state.active_subrail_step;
  const activeSubrail = state.active_subrail || state.flags?.active_subrail;

  if (enforceMode && input.kelly_lane_hint) {
    state.active_lane = input.kelly_lane_hint;
    state.step = LANE_FIRST_STEP[input.kelly_lane_hint] || state.step;
  }

  if (!opqrstInProgress) {
  if (activeSubrail === 'booking' || state.flags?.rebook_after_cancel) {
    state.conversation_mode = 'tenant_inbound_admin';
    state.flags.conversation_mode = 'tenant_inbound_admin';
  }

  if (activeSubrail === 'booking' || state.flags?.active_subrail === 'booking') {
    if (state.flags?.no_provider_availability) {
      state.active_lane = KELLY_LANE.SUPPORT;
      state.step = 'handoff';
      state.flags.booking_dead_end_redirect = true;
    } else {
    state.active_lane = KELLY_LANE.BOOKING;
    const intents =
      state.flags.booking_intents?.length > 0
        ? state.flags.booking_intents
        : enforceMode
          ? state.flags.booking_intents || []
          : detectBookingIntents(ctx.message, subrailStep);
    if (!enforceMode || intents.length) {
      applyBookingIntentsToFlags(state.flags, intents);
    }
    state.flags._turn_plan = planTurnOwner({ subrail: 'booking', flags: state.flags, intents });
    state.step = l2BookingPhaseToL4Step(subrailStep, state.flags);
    }
  }

  if (state.flags?.appt_lookup_only) {
    state.active_lane = KELLY_LANE.RESCHEDULE;
    state.step = L4_CANCEL_STEP.FIND_BOOKING;
    state.active_subrail = state.active_subrail || 'cancellation';
  } else if (activeSubrail === 'cancellation') {
    const cancelIntents =
      state.flags.cancel_intents?.length > 0
        ? state.flags.cancel_intents
        : enforceMode
          ? []
          : detectCancelIntents(ctx.message, subrailStep);
    const rescheduleIntents =
      state.flags.reschedule_intents?.length > 0
        ? state.flags.reschedule_intents
        : enforceMode
          ? []
          : detectRescheduleIntents(ctx.message, subrailStep);
    if (cancelIntents.length) applyCancelIntentsToFlags(state.flags, cancelIntents);
    if (rescheduleIntents.length) applyRescheduleIntentsToFlags(state.flags, rescheduleIntents);
    state.flags._turn_plan = planTurnOwner({
      subrail: 'cancellation',
      flags: state.flags,
      intents: [...cancelIntents, ...rescheduleIntents],
      step: subrailStep
    });
    state.active_lane = KELLY_LANE.RESCHEDULE;
    state.step = l2CancelPhaseToL4Step(subrailStep, state.flags);
    if (state.flags.reschedule_pending) {
      const msg = String(ctx.message || '');
      const hasExplicitSlot =
        /\d{4}-\d{2}-\d{2}/.test(msg) ||
        /\b\d{1,2}:\d{2}\b/.test(msg) ||
        !!(state.flags.current_booking_slot?.date && state.flags.current_booking_slot?.time) ||
        !!state.flags._slot_selected_time;
      if (state.flags.lookup_complete || hasExplicitSlot) {
        state.step = L4_CANCEL_STEP.MOVE_OR_CANCEL;
      }
    }
  }

  if (state.flags?.reschedule_pending && activeSubrail !== 'cancellation') {
    const msg = String(ctx.message || '').toLowerCase();
    const hasExplicitSlot =
      /\d{4}-\d{2}-\d{2}/.test(msg) ||
      /\b\d{1,2}:\d{2}\b/.test(msg) ||
      !!(state.flags.current_booking_slot?.date && state.flags.current_booking_slot?.time);
    if (state.flags.lookup_complete || hasExplicitSlot) {
      state.active_lane = KELLY_LANE.RESCHEDULE;
      state.step = 'move_or_cancel';
    } else {
      state.active_lane = KELLY_LANE.RESCHEDULE;
      state.step = 'find_booking';
      state.flags.cancel_find_pending = true;
    }
  }

  if (
    state.conversation_mode === 'tenant_records' ||
    input.kelly_lane_hint === 'records' ||
    state.flags?.conversation_mode === 'tenant_records' ||
    activeSubrail === 'records_qa'
  ) {
    const recordsIntents =
      state.flags.records_intents?.length > 0
        ? state.flags.records_intents
        : enforceMode
          ? []
          : detectRecordsIntents(ctx.message);
    if (!enforceMode || recordsIntents.length) applyRecordsIntentsToFlags(state.flags, recordsIntents);
    state.flags._turn_plan = planTurnOwner({
      subrail: 'records_qa',
      flags: state.flags,
      intents: recordsIntents
    });
    state.active_lane = KELLY_LANE.RECORDS;
    state.step = l2RecordsPhaseToL4Step();
    state.conversation_mode = state.conversation_mode || 'tenant_records';
    state.flags.conversation_mode = 'tenant_records';
  }

  if (state.conversation_mode === 'tenant_billing' && enforceMode) {
    state.active_lane = KELLY_LANE.PAYMENT;
    state.step = 'pay_invoice';
  }

  if (state.flags?.rebook_after_cancel && state.flags?.cancel_complete) {
    state.active_lane = KELLY_LANE.BOOKING;
    state.step = L4_BOOKING_STEP.SCHEDULE_VISIT;
    state.active_subrail = 'booking';
    state.active_subrail_step = 'slot_lookup';
    state.conversation_mode = 'tenant_inbound_admin';
    state.flags.conversation_mode = 'tenant_inbound_admin';
    state.flags.cancel_pending = false;
    state.flags.cancel_find_pending = false;
    state.flags.reschedule_pending = false;
  }

  if (state.flags?.rebook_after_cancel && !state.flags?.cancel_complete && activeSubrail === 'booking') {
    state.active_lane = KELLY_LANE.BOOKING;
    state.step = L4_BOOKING_STEP.SCHEDULE_VISIT;
    state.conversation_mode = 'tenant_inbound_admin';
  }
  }

  const skipLegacyRouting = shouldSkipLegacyRouting(state, enforceMode);
  const normalizedMessage = String(ctx.message || '').toLowerCase();
  const payIntentNow =
    !opqrstInProgress && PAYMENT_SIGNALS.some((s) => normalizedMessage.includes(s));
  const onRecordsRail = state.active_lane === KELLY_LANE.RECORDS;

  return { skipLegacyRouting, payIntentNow, onRecordsRail };
}

module.exports = {
  applyLaneStepFromL2Handoff,
  shouldSkipLegacyRouting
};
