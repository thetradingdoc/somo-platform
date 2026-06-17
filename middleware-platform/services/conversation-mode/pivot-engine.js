'use strict';

const { ConversationMode, Subrail, UserIntent } = require('./conversation-mode-types');
const { PivotEvent } = require('./pivot-events');
const { detectIntents, isEmergency } = require('./intent-detector');
const { canPivotToBilling, canPivotToRecords, canPivotToClinical } = require('./tenant-policy');

function isConversationModeRoutingEnforced() {
  return process.env.CONVERSATION_MODE_ROUTING === 'enforce';
}

function isConversationModeRoutingShadow() {
  const v = process.env.CONVERSATION_MODE_ROUTING;
  return !v || v === 'shadow';
}

/** Modes that never pivot to clinical/billing from outbound context. */
const OUTBOUND_MODES = new Set([
  ConversationMode.DEMO_QUAL,
  ConversationMode.OUTBOUND_SALES,
  ConversationMode.OPERATOR_OUTBOUND
]);

/**
 * Evaluate per-turn pivot decisions.
 * @returns {{ mode, subrail, pivot_event, pivot_reason, pending_intents, prior_mode }}
 */
function evaluateTurn(input = {}) {
  const utterance = input.utterance || input.message || '';
  const policy = input.tenantPolicy || {};
  const session = input.sessionState || {};
  const currentMode = session.conversation_mode || input.mode || ConversationMode.TENANT_INBOUND_ADMIN;
  const currentSubrail = session.active_subrail || input.subrail || null;
  const priorMode = currentMode;

  const result = {
    mode: currentMode,
    subrail: currentSubrail,
    pivot_event: null,
    pivot_reason: null,
    prior_mode: priorMode,
    pending_intents: [...(session.pending_intent_queue || [])],
    shadow_only: isConversationModeRoutingShadow()
  };

  if (OUTBOUND_MODES.has(currentMode)) {
    if (isEmergency(utterance)) {
      result.mode = ConversationMode.EMERGENCY_SAFETY;
      result.subrail = Subrail.HANDOFF;
      result.pivot_event = PivotEvent.EMERGENCY_DETECTED;
      result.pivot_reason = 'emergency_on_outbound';
    }
    return result;
  }

  const intents = detectIntents(utterance);
  const primary = intents[0]?.intent || UserIntent.GENERAL;
  const secondary = intents.slice(1).map((i) => i.intent);

  if (secondary.length > 0) {
    const existing = new Set(result.pending_intents);
    for (const si of secondary) {
      if (!existing.has(si)) {
        result.pending_intents.push(si);
        existing.add(si);
      }
    }
  }

  if (isEmergency(utterance) || primary === UserIntent.EMERGENCY) {
    result.mode = ConversationMode.EMERGENCY_SAFETY;
    result.subrail = Subrail.HANDOFF;
    result.pivot_event = PivotEvent.EMERGENCY_DETECTED;
    result.pivot_reason = 'emergency_phrase';
    return result;
  }

  if (primary === UserIntent.PAY_COPAY && canPivotToBilling(policy)) {
    result.prior_mode = currentMode;
    result.mode = ConversationMode.TENANT_BILLING;
    result.subrail = Subrail.COPAY_LINK;
    result.pivot_event = PivotEvent.BILLING_INTENT_DETECTED;
    result.pivot_reason = 'billing_pivot';
    return result;
  }

  if (primary === UserIntent.RECORDS && canPivotToRecords(policy)) {
    result.prior_mode = currentMode;
    result.mode = ConversationMode.TENANT_RECORDS;
    result.subrail = Subrail.RECORDS_QA;
    result.pivot_event = PivotEvent.RECORDS_INTENT_DETECTED;
    result.pivot_reason = 'records_pivot';
    return result;
  }

  if (
    primary === UserIntent.SYMPTOM &&
    canPivotToClinical(policy) &&
    currentMode === ConversationMode.TENANT_INBOUND_ADMIN
  ) {
    result.prior_mode = currentMode;
    result.mode = ConversationMode.TENANT_INBOUND_CLINICAL;
    result.subrail = Subrail.OPQRST;
    result.pivot_event = PivotEvent.SYMPTOM_INTENT_DETECTED;
    result.pivot_reason = 'admin_to_clinical';
    return result;
  }

  if (primary === UserIntent.CANCEL) {
    result.subrail = Subrail.CANCELLATION;
    result.pivot_event = PivotEvent.CANCEL_INTENT_DETECTED;
    result.pivot_reason = 'cancel_subrail';
    return result;
  }

  if (primary === UserIntent.APPT_LOOKUP) {
    result.subrail = Subrail.CANCELLATION;
    result.pivot_event = PivotEvent.CANCEL_INTENT_DETECTED;
    result.pivot_reason = 'appt_lookup';
    result.state_updates = { active_subrail_step: 'find_booking', appt_lookup_only: true };
    return result;
  }

  if (primary === UserIntent.RESCHEDULE || primary === UserIntent.BOOK) {
    if (currentSubrail === Subrail.CANCELLATION) {
      result.subrail = Subrail.BOOKING;
      result.pivot_event = PivotEvent.BOOK_INTENT_DETECTED;
      result.pivot_reason = 'cancel_to_booking';
      return result;
    }
    if (
      currentMode === ConversationMode.TENANT_INBOUND_CLINICAL &&
      currentSubrail === Subrail.OPQRST
    ) {
      return result;
    }
    result.subrail = Subrail.BOOKING;
    result.pivot_event = PivotEvent.BOOK_INTENT_DETECTED;
    result.pivot_reason = 'booking_subrail';
    return result;
  }

  if (primary === UserIntent.HANDOFF) {
    result.subrail = Subrail.HANDOFF;
    result.pivot_event = PivotEvent.HANDOFF_INTENT_DETECTED;
    result.pivot_reason = 'handoff_request';
    return result;
  }

  return result;
}

/** Apply pivot result to session state (preserves opqrst_accumulator on billing pivot). */
function applyPivotToSession(sessionState, pivotResult) {
  const next = { ...sessionState };
  if (pivotResult.prior_mode && pivotResult.mode !== pivotResult.prior_mode) {
    next.prior_conversation_mode = pivotResult.prior_mode;
  }
  next.conversation_mode = pivotResult.mode;
  next.active_subrail = pivotResult.subrail;
  next.pivot_reason = pivotResult.pivot_reason;
  next.pivot_event = pivotResult.pivot_event;
  next.pending_intent_queue = pivotResult.pending_intents || [];
  return next;
}

module.exports = {
  evaluateTurn,
  applyPivotToSession,
  isConversationModeRoutingEnforced,
  isConversationModeRoutingShadow,
  OUTBOUND_MODES
};
