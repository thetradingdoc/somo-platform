'use strict';

const { ConversationMode, Subrail, UserIntent } = require('./conversation-mode-types');
const { PivotEvent } = require('./pivot-events');
const { detectIntents, isEmergency, isCancelRebookUtterance, hasSymptomEvidence } = require('./intent-detector');
const { normalizeForIntentDetection } = require('./asr-normalize');
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
  ConversationMode.OPERATOR_OUTBOUND,
  ConversationMode.PLATFORM_SUPPORT
]);

/**
 * Evaluate per-turn pivot decisions.
 * @returns {{ mode, subrail, pivot_event, pivot_reason, pending_intents, prior_mode }}
 */
function evaluateTurn(input = {}) {
  const rawUtterance = input.utterance || input.message || '';
  const { normalized: utterance } = normalizeForIntentDetection(rawUtterance);
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

  if (
    isConversationModeRoutingEnforced() &&
    primary === UserIntent.GENERAL &&
    /demo|qualification|product demo/i.test(utterance) &&
    currentMode !== ConversationMode.DEMO_QUAL
  ) {
    result.pivot_reason = 'demo_qual_pivot_blocked';
    return result;
  }

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
    hasSymptomEvidence(utterance) &&
    canPivotToClinical(policy) &&
    currentMode === ConversationMode.TENANT_INBOUND_ADMIN &&
    !session.rebook_after_cancel &&
    currentSubrail !== Subrail.BOOKING
  ) {
    result.prior_mode = currentMode;
    result.mode = ConversationMode.TENANT_INBOUND_CLINICAL;
    result.subrail = Subrail.OPQRST;
    result.pivot_event = PivotEvent.SYMPTOM_INTENT_DETECTED;
    result.pivot_reason = 'admin_to_clinical';
    return result;
  }

  if (primary === UserIntent.CANCEL) {
    const wantsRebook =
      isCancelRebookUtterance(utterance) || result.pending_intents.includes(UserIntent.BOOK);
    result.subrail = Subrail.CANCELLATION;
    result.pivot_event = PivotEvent.CANCEL_INTENT_DETECTED;
    result.pivot_reason = wantsRebook ? 'cancel_rebook_subrail' : 'cancel_subrail';
    if (wantsRebook) {
      if (!result.pending_intents.includes(UserIntent.BOOK)) {
        result.pending_intents.push(UserIntent.BOOK);
      }
      result.state_updates = {
        active_subrail_step: 'find_booking',
        rebook_after_cancel: true,
        pending_intent_queue: [...result.pending_intents]
      };
    }
    return result;
  }

  if (primary === UserIntent.APPT_LOOKUP) {
    result.subrail = Subrail.CANCELLATION;
    result.pivot_event = PivotEvent.CANCEL_INTENT_DETECTED;
    result.pivot_reason = 'appt_lookup';
    result.state_updates = { active_subrail_step: 'find_booking', appt_lookup_only: true };
    return result;
  }

  if (primary === UserIntent.RESCHEDULE) {
    result.subrail = Subrail.CANCELLATION;
    result.pivot_event = PivotEvent.CANCEL_INTENT_DETECTED;
    result.pivot_reason = 'reschedule_subrail';
    result.state_updates = {
      active_subrail_step: 'find_booking',
      reschedule_pending: true
    };
    return result;
  }

  if (primary === UserIntent.BOOK) {
    if (session.rebook_after_cancel || (session.cancel_complete && /book|new time|schedule/.test(utterance))) {
      result.mode = ConversationMode.TENANT_INBOUND_ADMIN;
      result.subrail = Subrail.BOOKING;
      result.pivot_event = PivotEvent.BOOK_INTENT_DETECTED;
      result.pivot_reason = 'rebook_after_cancel';
      result.state_updates = {
        rebook_after_cancel: true,
        active_subrail: 'booking',
        active_subrail_step: 'slot_lookup',
        conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN
      };
      return result;
    }
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
      result.state_updates = {
        active_subrail: Subrail.BOOKING,
        active_subrail_step: 'slot_lookup',
        conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN,
        _sync_triage_to_projection: true
      };
      result.subrail = Subrail.BOOKING;
      result.pivot_event = PivotEvent.BOOK_INTENT_DETECTED;
      result.pivot_reason = 'opqrst_to_booking';
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

/** Apply pivot result to session state (preserves opqrst_resume_field on billing/records/cancel pivots). */
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

  const preserveOpqrstResume = new Set([
    PivotEvent.BILLING_INTENT_DETECTED,
    PivotEvent.RECORDS_INTENT_DETECTED,
    PivotEvent.CANCEL_INTENT_DETECTED
  ]);
  if (preserveOpqrstResume.has(pivotResult.pivot_event)) {
    const resume =
      sessionState.opqrst_resume_field ||
      sessionState.flags?.opqrst_resume_field ||
      sessionState.flags?._opqrst_gate?.openField ||
      sessionState._opqrst_gate?.openField;
    if (resume) {
      next.opqrst_resume_field = resume;
    }
    if (sessionState.opqrst_accumulator && typeof sessionState.opqrst_accumulator === 'object') {
      next.opqrst_accumulator = sessionState.opqrst_accumulator;
    }
  }

  return next;
}

module.exports = {
  evaluateTurn,
  applyPivotToSession,
  isConversationModeRoutingEnforced,
  isConversationModeRoutingShadow,
  OUTBOUND_MODES
};
