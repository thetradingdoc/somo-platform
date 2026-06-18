'use strict';

/**
 * L2 → L4 handoff contract.
 * Under enforce, L4 must consume this shape — not re-parse raw utterances for routing.
 */

const REQUIRED_HANDOFF_FIELDS = Object.freeze([
  'conversation_mode',
  'active_subrail',
  'active_subrail_step'
]);

const OPTIONAL_HANDOFF_FIELDS = Object.freeze([
  'kelly_lane_hint',
  'booking_intents',
  'cancel_intents',
  'reschedule_intents',
  'records_intents',
  'pivot_reason',
  'appt_lookup_only',
  'reschedule_pending',
  'cancel_pending',
  'rebook_after_cancel'
]);

/**
 * @param {object} input - dispatcher / executeTurn input
 * @returns {{ valid: boolean, handoff: object, missing: string[] }}
 */
function normalizeL2Handoff(input = {}) {
  const session = input.conversation_session || {};
  const handoff = {
    conversation_mode:
      input.conversation_mode || session.conversation_mode || input.flags?.conversation_mode || null,
    active_subrail: input.active_subrail || session.active_subrail || input.flags?.active_subrail || null,
    active_subrail_step:
      input.active_subrail_step ||
      session.active_subrail_step ||
      input.flags?.active_subrail_step ||
      null,
    kelly_lane_hint: input.kelly_lane_hint || session.kelly_lane_hint || null,
    booking_intents: input.flags?.booking_intents || session.booking_intents || [],
    cancel_intents: input.flags?.cancel_intents || session.cancel_intents || [],
    reschedule_intents: input.flags?.reschedule_intents || session.reschedule_intents || [],
    records_intents: input.flags?.records_intents || session.records_intents || [],
    pivot_reason: session.pivot_reason || input.flags?.pivot_reason || null,
    appt_lookup_only: !!(input.flags?.appt_lookup_only || session.appt_lookup_only),
    reschedule_pending: !!(input.flags?.reschedule_pending || session.reschedule_pending),
    cancel_pending: !!(input.flags?.cancel_pending || session.cancel_pending),
    rebook_after_cancel: !!(input.flags?.rebook_after_cancel || session.rebook_after_cancel)
  };

  const missing = REQUIRED_HANDOFF_FIELDS.filter((f) => !handoff[f]);
  return {
    valid: missing.length === 0,
    handoff,
    missing
  };
}

/**
 * Under enforce, L4 routing must use handoff fields only.
 */
function enforceHandoffOnlyRouting(enforceMode, handoff) {
  return !!(enforceMode && handoff.conversation_mode);
}

module.exports = {
  REQUIRED_HANDOFF_FIELDS,
  OPTIONAL_HANDOFF_FIELDS,
  normalizeL2Handoff,
  enforceHandoffOnlyRouting
};
