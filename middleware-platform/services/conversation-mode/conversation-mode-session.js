'use strict';

/**
 * Conversation mode session helpers — merge mode state into Kelly Rails SSOT.
 */

const { persistRailsSessionState, getRailsSessionProjection } = require('../kelly-rails/session-ssot');
const { defaultConversationFields } = require('../kelly-rails/state-schema');
const { resolveConversationMode } = require('./conversation-mode-resolver');
const { evaluateTurn, applyPivotToSession } = require('./pivot-engine');
const { loadTenantPolicyFromProfile } = require('./tenant-policy');
const { resolveDispositionFromState } = require('./disposition-taxonomy');
const { dispatchConversationTurn } = require('./conversation-dispatcher');
const { shouldEnforceMode } = require('./config');
const { UserIntent } = require('./conversation-mode-types');

function loadConversationSession(sessionId, db) {
  const projection = getRailsSessionProjection(sessionId);
  let fields = defaultConversationFields();
  if (projection?.flags_json) {
    try {
      const parsed = JSON.parse(projection.flags_json);
      fields = { ...fields, ...parsed };
    } catch (_) {}
  }
  return fields;
}

function saveConversationSession(sessionId, fields) {
  persistRailsSessionState(sessionId, {
    active_lane: fields.kelly_lane_hint || fields.active_lane || null,
    step: fields.active_subrail_step || fields.step || null,
    flags: fields
  });
}

function writeSessionIfPresent(opts, fields) {
  const sid = sessionId(opts);
  if (!sid) return;
  saveConversationSession(sid, fields);
}

function seedModeAtCallStart(opts = {}) {
  const policy = opts.tenantPolicy || loadTenantPolicyFromProfile(opts.db, opts.clinicId, opts.customerId);
  const resolved = resolveConversationMode({
    call_type: opts.call_type,
    direction: opts.direction,
    tenantPolicy: policy,
    firstUtterance: opts.firstUtterance || '',
    tenantResolved: opts.tenantResolved !== false
  });
  const fields = {
    ...defaultConversationFields(),
    conversation_mode: resolved.mode,
    active_subrail: resolved.subrail,
    pivot_reason: resolved.reason,
    call_type: resolved.call_type,
    direction: resolved.direction,
    fail_closed: !!resolved.fail_closed
  };
  if (resolved.reason === 'intent_appt_lookup') {
    fields.active_subrail_step = 'find_booking';
    fields.appt_lookup_only = true;
  }
  if (opts.appointment_id || opts.appointmentId) {
    fields.appointment_id = opts.appointment_id || opts.appointmentId;
  }
  if (opts.outbound_purpose) {
    fields.outbound_purpose = opts.outbound_purpose;
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

  const pivot = evaluateTurn({
    mode: session.conversation_mode,
    subrail: session.active_subrail,
    utterance: opts.message || opts.utterance || '',
    tenantPolicy: policy,
    sessionState: session
  });

  const nextSession = applyPivotToSession(session, pivot);
  if (pivot.state_updates) Object.assign(nextSession, pivot.state_updates);

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

  if (dispatch.state_updates && sessionId(opts)) {
    const merged = { ...session, ...dispatch.state_updates };
    writeSessionIfPresent(opts, merged);
  }

  if (dispatch.drain_pending_intents && session.pending_intent_queue?.length) {
    const nextIntent = session.pending_intent_queue[0];
    const remaining = session.pending_intent_queue.slice(1);
    const completed = [...(session.completed_intents || []), nextIntent];
    const updates = {
      pending_intent_queue: remaining,
      completed_intents: completed
    };
    if (nextIntent === UserIntent.RESCHEDULE || nextIntent === UserIntent.BOOK) {
      updates.active_subrail = 'booking';
      updates.active_subrail_step = 'intent_confirm';
    }
    writeSessionIfPresent(opts, { ...session, ...updates });
  }

  return {
    session,
    pivot,
    policy,
    dispatch,
    enforce,
    use_kelly: dispatch.use_kelly !== false && !dispatch.reply,
    kelly_lane_hint: dispatch.kelly_lane_hint
  };
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
  emitDisposition
};
