'use strict';

/**
 * Conversation mode session helpers — merge mode state into Kelly Rails SSOT.
 */

const { persistRailsSessionState, getRailsSessionProjection, mergeConversationStateUpdates } = require('../kelly/rails/session-ssot');
const { defaultConversationFields } = require('../kelly/rails/state-schema');
const { isOpqrstInProgress } = require('../kelly/rails/opqrst-in-progress');
const { isOpqrstFieldGateEnabled } = require('../kelly/rails/config');
const { resolveConversationMode } = require('./conversation-mode-resolver');
const { evaluateTurn, applyPivotToSession } = require('./pivot-engine');
const { normalizeForIntentDetection } = require('./asr-normalize');
const { loadTenantPolicyFromProfile } = require('./tenant-policy');
const { resolveDispositionFromState } = require('./disposition-taxonomy');
const { dispatchConversationTurn } = require('./conversation-dispatcher');
const { shouldEnforceMode } = require('./config');
const { UserIntent } = require('./conversation-mode-types');
const { Handoff } = require('./handoff-types');

function loadConversationSession(sessionId, db) {
  const projection = getRailsSessionProjection(sessionId);
  let fields = defaultConversationFields();
  if (projection?.flags_json) {
    try {
      const parsed = JSON.parse(projection.flags_json);
      fields = { ...fields, ...parsed };
    } catch (_) {}
  }
  if (projection?.appointment_id && !fields.appointment_id) {
    fields.appointment_id = projection.appointment_id;
  }
  return fields;
}

function saveConversationSession(sessionId, fields) {
  mergeConversationStateUpdates(sessionId, fields, {});
}

function writeSessionIfPresent(opts, fields, dispatchUpdates = null) {
  const sid = sessionId(opts);
  if (!sid) return;
  if (dispatchUpdates) {
    mergeConversationStateUpdates(sid, fields, dispatchUpdates);
  } else {
    saveConversationSession(sid, fields);
  }
}

function seedModeAtCallStart(opts = {}) {
  const policy = opts.tenantPolicy || loadTenantPolicyFromProfile(opts.db, opts.clinicId, opts.customerId);
  const resolved = resolveConversationMode({
    call_type: opts.call_type,
    direction: opts.direction,
    tenantPolicy: policy,
    firstUtterance: opts.firstUtterance || '',
    tenantResolved: opts.tenantResolved !== false,
    routing_world: opts.routing_world || null,
    site_context_status: opts.site_context_status || opts.siteContextStatus || null
  });
  const fields = {
    ...defaultConversationFields(),
    conversation_mode: resolved.mode,
    active_subrail: resolved.subrail,
    pivot_reason: resolved.reason,
    call_type: resolved.call_type,
    direction: resolved.direction,
    fail_closed: !!resolved.fail_closed,
    routing_world: opts.routing_world || null
  };
  if (resolved.reason === 'intent_appt_lookup') {
    fields.active_subrail_step = 'find_booking';
    fields.appt_lookup_only = true;
  }
  if (resolved.reason === 'intent_reschedule' || resolved.reason === 'intent_cancel') {
    fields.active_subrail_step = 'find_booking';
  }
  if (resolved.reason === 'intent_reschedule') {
    fields.reschedule_pending = true;
  }
  if (resolved.reason === 'intent_records') {
    fields.active_subrail_step = 'records_qa';
  }
  if (opts.appointment_id || opts.appointmentId) {
    fields.appointment_id = opts.appointment_id || opts.appointmentId;
  }
  if (opts.outbound_purpose) {
    fields.outbound_purpose = opts.outbound_purpose;
  }
  if (opts.firstUtterance) {
    const { primaryIntent } = require('./intent-detector');
    const { UserIntent } = require('./conversation-mode-types');
    const intent = primaryIntent(opts.firstUtterance);
    if (intent.intent === UserIntent.PAY_COPAY && policy.billing_enabled !== false) {
      fields.conversation_mode = 'tenant_billing';
      fields.active_subrail = 'copay_link';
      fields.pivot_reason = 'intent_billing_at_start';
    }
    if (intent.intent === UserIntent.RECORDS && policy.records_enabled !== false) {
      fields.conversation_mode = 'tenant_records';
      fields.active_subrail = 'records_qa';
      fields.active_subrail_step = 'records_qa';
      fields.pivot_reason = 'intent_records_at_start';
    }
  }
  writeSessionIfPresent(opts, fields);
  return { resolved, fields, policy };
}

function sessionId(opts) {
  return String(opts.sessionId || opts.session_id || '').trim();
}

function processConversationTurn(opts = {}) {
  const sid = sessionId(opts);
  const db = opts.db;
  const policy = opts.tenantPolicy || loadTenantPolicyFromProfile(db, opts.clinicId, opts.customerId);
  let session = sid ? loadConversationSession(sid, db) : defaultConversationFields();

  if (!session.conversation_mode && opts.call_type) {
    const seeded = seedModeAtCallStart(opts);
    session = seeded.fields;
  }

  const rawMessage = opts.message || opts.utterance || '';
  const { normalized: intentMessage } = normalizeForIntentDetection(rawMessage);

  const pivot = evaluateTurn({
    mode: session.conversation_mode,
    subrail: session.active_subrail,
    utterance: intentMessage,
    tenantPolicy: policy,
    sessionState: session,
    sessionId: sid,
    clinicId: opts.clinicId,
    customerId: opts.customerId
  });

  const nextSession = applyPivotToSession(session, pivot);
  if (pivot.state_updates) Object.assign(nextSession, pivot.state_updates);

  if (pivot.state_updates?._sync_triage_to_projection && sid) {
    try {
      const { syncTriageFieldsToProjection } = require('../kelly/rails/session-ssot');
      syncTriageFieldsToProjection(sid, {
        active_subrail: nextSession.active_subrail,
        active_subrail_step: nextSession.active_subrail_step,
        conversation_mode: nextSession.conversation_mode
      });
      delete nextSession._sync_triage_to_projection;
    } catch (_) {}
  }

  if (sid) saveConversationSession(sid, nextSession);

  try {
    db?.insertKellyCallEvent?.({
      session_id: sid || null,
      call_id: opts.callId || null,
      event_type: pivot.pivot_event ? 'pivot_evaluated' : 'mode_resolved',
      payload_json: {
        conversation_mode: nextSession.conversation_mode,
        active_subrail: nextSession.active_subrail,
        pivot_event: pivot.pivot_event,
        pivot_reason: pivot.pivot_reason,
        prior_mode: pivot.prior_mode,
        pending_intent_queue: nextSession.pending_intent_queue,
        shadow_only: pivot.shadow_only
      }
    });
  } catch (_) {}

  return { session: nextSession, pivot, policy };
}

function shouldDeferQueuedIntent(session = {}, intent) {
  const deferIntents = [UserIntent.BOOK, UserIntent.PAY_COPAY, UserIntent.RECORDS];
  if (!deferIntents.includes(intent)) return false;

  const gateOpenField = session._opqrst_gate?.openField;
  if (isOpqrstFieldGateEnabled() && gateOpenField) return true;

  const sid = String(session.session_id || session.sessionId || '').trim();
  let triageRow = null;
  if (sid) {
    try {
      const db = require('../../database');
      triageRow = db.getTriageSession?.(sid) || null;
    } catch (_) {}
  }
  const frozen = isOpqrstInProgress(
    {
      flags: session,
      conversation_mode: session.conversation_mode,
      active_subrail: session.active_subrail,
      active_lane: session.active_lane
    },
    triageRow,
    {}
  );
  if (frozen) return true;

  if (session.has_rag || session.triage_complete) return false;
  return false;
}

function drainPendingIntentsForAppointment(session = {}, triggerFlags = {}) {
  const shouldDrain =
    triggerFlags.cancel_complete ||
    triggerFlags.schedule_appointment_success ||
    triggerFlags.reschedule_complete ||
    triggerFlags.records_complete ||
    triggerFlags.triage_complete ||
    triggerFlags.has_rag ||
    session.cancel_complete ||
    session.schedule_appointment_success ||
    session.reschedule_complete ||
    session.triage_complete ||
    session.has_rag;
  if (!shouldDrain || !session.pending_intent_queue?.length) {
    return session;
  }

  const nextIntent = session.pending_intent_queue[0];
  const sessionForDefer = {
    ...session,
    triage_complete: !!(session.triage_complete || triggerFlags.triage_complete),
    has_rag: !!(session.has_rag || triggerFlags.has_rag),
    _opqrst_gate: session._opqrst_gate || triggerFlags._opqrst_gate
  };
  if (
    (nextIntent === UserIntent.BOOK ||
      nextIntent === UserIntent.PAY_COPAY ||
      nextIntent === UserIntent.RECORDS) &&
    shouldDeferQueuedIntent(sessionForDefer, nextIntent)
  ) {
    return session;
  }
  const remaining = session.pending_intent_queue.slice(1);
  const updates = {
    pending_intent_queue: remaining,
    completed_intents: [...(session.completed_intents || []), nextIntent]
  };

  if (nextIntent === UserIntent.RESCHEDULE || nextIntent === UserIntent.BOOK) {
    updates.rebook_after_cancel = !!(triggerFlags.cancel_complete || session.cancel_complete);
    updates.active_subrail = 'booking';
    updates.active_subrail_step = 'slot_lookup';
    updates.conversation_mode = 'tenant_inbound_admin';
    updates.handoff_pending = Handoff.KELLY_REQUIRED;
    updates.kelly_lane_hint = 'booking';
  }
  if (nextIntent === UserIntent.PAY_COPAY) {
    updates.active_subrail = 'copay_link';
    updates.conversation_mode = 'tenant_billing';
    updates.handoff_pending = Handoff.KELLY_REQUIRED;
  }

  return { ...session, ...updates };
}

function mergeKellyRailsIntoSession(session = {}, kellyRails = {}, toolsUsed = []) {
  const flags = kellyRails.flags || {};
  const merged = {
    ...session,
    active_lane: kellyRails.active_lane || session.active_lane,
    step: kellyRails.step || session.step,
    active_subrail: kellyRails.active_subrail || flags.active_subrail || session.active_subrail,
    active_subrail_step:
      flags.active_subrail_step || session.active_subrail_step || kellyRails.step || null,
    ...flags
  };

  if ((toolsUsed || []).includes('schedule_appointment') && flags.schedule_appointment_success) {
    merged.schedule_appointment_success = true;
  }
  if ((toolsUsed || []).includes('search_appointments')) {
    merged.lookup_complete = flags.lookup_complete !== false;
    if (flags.last_appointment_id) merged.last_appointment_id = flags.last_appointment_id;
  }
  if ((toolsUsed || []).includes('cancel_appointment')) {
    merged.cancel_complete = true;
    merged.cancel_pending = false;
  }
  if ((toolsUsed || []).includes('reschedule_appointment')) {
    merged.reschedule_complete = true;
    merged.reschedule_pending = false;
  }
  if ((toolsUsed || []).includes('query_patient_records')) {
    merged.records_complete = true;
  }
  if (kellyRails.active_lane === 'booking' && !flags.opqrst_in_progress) {
    const sid = String(session.session_id || session.sessionId || '').trim();
    let triageRow = null;
    if (sid) {
      try {
        const db = require('../../database');
        triageRow = db.getTriageSession?.(sid) || null;
      } catch (_) {}
    }
    const frozen = isOpqrstInProgress(
      {
        flags: { ...flags, ...session },
        conversation_mode: merged.conversation_mode,
        active_subrail: merged.active_subrail,
        active_lane: kellyRails.active_lane
      },
      triageRow,
      {}
    );
    if (!frozen) {
      merged.active_subrail = merged.active_subrail || 'booking';
      merged.conversation_mode = merged.conversation_mode || 'tenant_inbound_admin';
      merged.kelly_lane_hint = 'booking';
    }
  }
  if (kellyRails.active_lane === 'reschedule') {
    merged.kelly_lane_hint = merged.kelly_lane_hint || 'reschedule';
  }

  return drainPendingIntentsForAppointment(merged, flags);
}

async function runConversationDispatch(opts = {}) {
  const { session, pivot, policy } = processConversationTurn(opts);
  const mode = session.conversation_mode;
  const enforce = shouldEnforceMode(mode);

  const dispatchCtx = {
    ...opts,
    conversation_mode: mode,
    active_subrail: session.active_subrail,
    active_subrail_step: session.active_subrail_step,
    billing_step: session.billing_step,
    opqrst_accumulator: session.opqrst_accumulator,
    cancellation_context: session.cancellation_context,
    pending_intent_queue: session.pending_intent_queue,
    tenantPolicy: policy,
    prior_conversation_mode: session.prior_conversation_mode,
    opener_delivered: !!(opts.opener_delivered || session.opener_delivered),
    appt_lookup_only: session.appt_lookup_only,
    appointment_id: session.appointment_id || opts.appointmentId || opts.appointment_id || null,
    outbound_purpose: session.outbound_purpose || opts.outbound_purpose || null
  };

  const dispatch = await dispatchConversationTurn(mode, dispatchCtx);

  let mergedSession = { ...session };
  if (dispatch.state_updates) {
    mergedSession = { ...mergedSession, ...dispatch.state_updates };
    writeSessionIfPresent(opts, mergedSession, dispatch.state_updates);
  }

  if (dispatch.drain_pending_intents && mergedSession.pending_intent_queue?.length) {
    const nextIntent = mergedSession.pending_intent_queue[0];
    if (!shouldDeferQueuedIntent(mergedSession, nextIntent)) {
    const remaining = mergedSession.pending_intent_queue.slice(1);
    const completed = [...(mergedSession.completed_intents || []), nextIntent];
    const updates = {
      pending_intent_queue: remaining,
      completed_intents: completed
    };
    if (nextIntent === UserIntent.RESCHEDULE || nextIntent === UserIntent.BOOK) {
      updates.active_subrail = 'booking';
      updates.active_subrail_step = 'intent_confirm';
      updates.handoff_pending = Handoff.KELLY_REQUIRED;
    }
    if (nextIntent === UserIntent.PAY_COPAY) {
      updates.active_subrail = 'copay_link';
      updates.conversation_mode = 'tenant_billing';
      updates.handoff_pending = Handoff.KELLY_REQUIRED;
    }
    mergedSession = { ...mergedSession, ...updates };
    writeSessionIfPresent(opts, mergedSession);
    }
  }

  const handoff = dispatch.handoff || Handoff.KELLY_OPTIONAL;
  const needsKelly =
    handoff === Handoff.KELLY_REQUIRED || handoff === Handoff.KELLY_OPTIONAL;

  return {
    session: mergedSession,
    pivot,
    policy,
    dispatch,
    enforce,
    handoff,
    needs_kelly: needsKelly,
    kelly_lane_hint: dispatch.kelly_lane_hint || modeToKellyLaneHint(mode, mergedSession.active_subrail)
  };
}

function modeToKellyLaneHint(mode, subrail) {
  const { modeToKellyLane } = require('./conversation-dispatcher');
  return modeToKellyLane(mode, subrail);
}

function emitDisposition(db, opts = {}) {
  const disposition = opts.disposition || resolveDispositionFromState(opts.session || opts);
  try {
    db?.insertKellyCallEvent?.({
      session_id: opts.sessionId || opts.session_id || null,
      call_id: opts.callId || null,
      event_type: 'disposition_emitted',
      payload_json: {
        disposition,
        conversation_mode: opts.conversation_mode,
        active_subrail: opts.active_subrail
      }
    });
  } catch (_) {}
  return disposition;
}

module.exports = {
  loadConversationSession,
  saveConversationSession,
  seedModeAtCallStart,
  processConversationTurn,
  runConversationDispatch,
  mergeKellyRailsIntoSession,
  drainPendingIntentsForAppointment,
  emitDisposition
};
