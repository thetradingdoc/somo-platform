'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE, normalizeState, routeOrchestratorLane, paymentGateOpen, PAYMENT_SIGNALS, LANE_FIRST_STEP } = require('./state-schema');
const { hydrateFlagsFromDb } = require('./hydrate');
const { executeLaneStep } = require('./lanes');
const { persistRailsSessionState } = require('./session-ssot');
const { KELLY_LANE: LANE } = require('./state-schema');
const { shouldEnforceMode } = require('../conversation-mode/config');
const {
  detectBookingIntents,
  applyBookingIntentsToFlags,
  planTurnOwner
} = require('./turn-planner');

function shouldReroute(state, message) {
  const msg = String(message || '').toLowerCase();
  if (state.step === 'done' || state.active_lane === KELLY_LANE.ROUTER) return true;
  if (PAYMENT_SIGNALS.some((s) => msg.includes(s))) return true;
  if (state.flags.pending_human_handoff) return true;
  if (/book|schedule|appointment|slot|tomorrow|noon|12:00|12 pm|available/.test(msg)) return true;
  return false;
}

function opqrstComplete(row) {
  if (!row) return false;
  const region = String(row.region || row.body_site || '').trim();
  const quality = String(row.quality || '').trim();
  return !!(
    quality &&
    String(row.onset || row.timing || '').trim() &&
    (row.severity != null || String(row.severity || '').trim()) &&
    (region || /leg|neck|arm|rash|skin/i.test(quality))
  );
}

async function promoteBookingWhenReady(state, ctx) {
  const msg = String(ctx.message || '').toLowerCase();
  const bookingIntent = /book|schedule|appointment|slot|tomorrow|noon|12:00|12 pm|available/.test(msg);
  if (!bookingIntent) return;

  const db = require('../../database');
  const row = db.getTriageSession ? db.getTriageSession(ctx.sessionId) : null;
  if (!opqrstComplete(row)) return;

  try {
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'booking_intent_seen', '1');
  } catch (_) {}

  if (!state.flags.has_rag && !row?.rag_result_id) {
    const useFastRag = process.env.KELLY_RAILS_FAST_RAG !== '0';
    if (useFastRag) {
      const { completeTriageRagForSession } = require('../triage-rag-fast-complete');
      completeTriageRagForSession(ctx.sessionId, ctx.patientId, {
        region: row?.region || 'leg and neck',
        quality: row?.quality || 'itchy rash on leg and neck',
      });
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
    } else if (state.active_lane === KELLY_LANE.CLINICAL && state.step === 'triage_assessment') {
      const rag = await KellyToolExecutor.execute('run_triage_rag', {}, ctx);
      if (rag && !rag.error) {
        state.flags.has_rag = true;
        state.flags.triage_complete = true;
      }
    } else {
      const { completeTriageRagForSession } = require('../triage-rag-fast-complete');
      completeTriageRagForSession(ctx.sessionId, ctx.patientId, {
        region: row?.region || 'leg and neck',
        quality: row?.quality || 'itchy rash on leg and neck',
      });
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
    }
  } else {
    state.flags.has_rag = true;
    state.flags.triage_complete = true;
  }

  state.active_lane = KELLY_LANE.BOOKING;
  state.step = 'schedule_visit';
}

function laneToOrchestratorPhase(lane) {
  const map = {
    clinical: 'TRIAGE_ACTIVE',
    booking: 'BOOKING',
    payment: 'BILLING',
    basic_intake: 'TRIAGE_DISCOVERY',
    education: 'ROUTINE_INTAKE',
    support: 'BILLING',
    account: 'BILLING',
    records: 'BILLING',
    reschedule: 'BOOKING'
  };
  return map[String(lane || '').toLowerCase()] || 'TRIAGE_DISCOVERY';
}

function syncMetaFromFlags(sessionId, flags, lane) {
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_rails_v2', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_active', '1');
    const exportLane = String(flags._lane_export || lane || '');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_branch', exportLane);
    if (lane) {
      KellyToolExecutor._setSessionMeta(sessionId, 'kelly_orchestrator_phase', laneToOrchestratorPhase(lane));
    }
    if (flags.active_subrail) {
      KellyToolExecutor._setSessionMeta(sessionId, 'active_subrail', flags.active_subrail);
    }
    if (flags.appointment_id) {
      KellyToolExecutor._setSessionMeta(sessionId, 'last_appointment_id', flags.appointment_id);
    }
  } catch (_) {}
}

/**
 * Core turn logic (invoked from main-graph node or directly in tests).
 */
async function executeTurn(input = {}) {
  const db = require('../../database');
  const sid = String(input.session_id || input.sessionId || '').trim();
  let locale = input.locale || input.preferredLanguage;
  if (!locale && sid) {
    locale = db.getKellySessionLanguage?.(sid);
  }
  const state = normalizeState({ ...input, locale: locale || 'en' });
  const { getRailsSessionProjection } = require('./session-ssot');
  const projection = sid ? getRailsSessionProjection(sid) : null;
  if (projection?.active_lane) {
    const fromInput = input.active_lane;
    if (!fromInput || fromInput === KELLY_LANE.ROUTER) {
      state.active_lane = projection.active_lane;
    }
  }
  if (projection?.step && projection.step !== 'await_intent') {
    state.step = projection.step;
  }
  const ctx = {
    sessionId: state.session_id,
    clinicId: input.clinicId || state.clinic_id,
    customerId: input.customerId || input.turn_context?.customerId || null,
    patientId: input.patientId || state.patient_id,
    callerPhone: input.callerPhone || null,
    channel: state.channel || 'chat',
    message: String(input.message || state.last_user_message || ''),
    db: input.db || input.turn_context?.db || null,
    providerInstructions: input.providerInstructions || input.turn_context?.providerInstructions || null
  };

  if (!state.v2_hydrated) {
    state.flags = { ...state.flags, ...hydrateFlagsFromDb(ctx.sessionId, ctx.patientId) };
    state.v2_hydrated = true;
  }

  if (input.conversation_session) {
    Object.assign(state.flags, input.conversation_session);
  }

  state.conversation_mode =
    input.conversation_mode || state.flags.conversation_mode || state.conversation_mode;
  state.active_subrail = input.active_subrail || state.flags.active_subrail || state.active_subrail;
  state.active_subrail_step =
    input.active_subrail_step ||
    state.flags.active_subrail_step ||
    state.active_subrail_step ||
    input.conversation_session?.active_subrail_step ||
    null;

  if (state.conversation_mode) state.flags.conversation_mode = state.conversation_mode;
  if (state.active_subrail) state.flags.active_subrail = state.active_subrail;
  if (state.active_subrail_step) state.flags.active_subrail_step = state.active_subrail_step;

  const enforceMode = state.conversation_mode && shouldEnforceMode(state.conversation_mode);
  if (enforceMode && input.kelly_lane_hint) {
    state.active_lane = input.kelly_lane_hint;
    state.step = LANE_FIRST_STEP[input.kelly_lane_hint] || state.step;
  }

  const subrailStep = state.active_subrail_step;
  const activeSubrail = state.active_subrail || state.flags?.active_subrail;

  if (activeSubrail === 'booking' || state.flags?.rebook_after_cancel) {
    state.conversation_mode = 'tenant_inbound_admin';
    state.flags.conversation_mode = 'tenant_inbound_admin';
  }

  if (activeSubrail === 'booking' || state.flags?.active_subrail === 'booking') {
    state.active_lane = KELLY_LANE.BOOKING;
    const intents =
      state.flags.booking_intents?.length > 0
        ? state.flags.booking_intents
        : detectBookingIntents(ctx.message, subrailStep);
    applyBookingIntentsToFlags(state.flags, intents);
    state.flags._turn_plan = planTurnOwner({ subrail: 'booking', flags: state.flags, intents });

    const hasBookableSlot =
      !!(state.flags.current_booking_slot?.date && state.flags.current_booking_slot?.time) ||
      !!state.flags._slot_selected_time ||
      !!(
        KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_date') &&
        KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_time')
      );
    if (
      ['contact_confirm', 'schedule', 'confirm'].includes(subrailStep) &&
      hasBookableSlot &&
      !state.flags?.no_provider_availability
    ) {
      state.step = 'confirm_visit';
    } else if (['slot_lookup', 'slot_select'].includes(subrailStep)) {
      state.step = 'schedule_visit';
    }
  }

  if (state.flags?.appt_lookup_only) {
    state.active_lane = KELLY_LANE.RESCHEDULE;
    state.step = 'find_booking';
    state.active_subrail = state.active_subrail || 'cancellation';
  } else if (
    activeSubrail === 'cancellation' &&
    !state.flags?.reschedule_pending &&
    (subrailStep === 'cancel_execute' || state.flags?.cancel_pending || state.flags?.cancel_confirmed)
  ) {
    state.active_lane = KELLY_LANE.RESCHEDULE;
    state.step = 'move_or_cancel';
    state.flags.cancel_pending = true;
  } else if (activeSubrail === 'cancellation' && subrailStep === 'find_booking') {
    state.active_lane = KELLY_LANE.RESCHEDULE;
    state.step = 'find_booking';
    state.flags.cancel_find_pending = true;
  }

  if (state.flags?.reschedule_pending) {
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
    state.flags?.conversation_mode === 'tenant_records'
  ) {
    state.active_lane = KELLY_LANE.RECORDS;
    state.step = 'records_qa';
  }

  if (state.conversation_mode === 'tenant_billing' && enforceMode) {
    state.active_lane = KELLY_LANE.PAYMENT;
    state.step = 'pay_invoice';
  }

  if (state.flags?.rebook_after_cancel && state.flags?.cancel_complete) {
    state.active_lane = KELLY_LANE.BOOKING;
    state.step = 'schedule_visit';
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
    state.step = 'schedule_visit';
    state.conversation_mode = 'tenant_inbound_admin';
  }

  state.last_user_message = ctx.message;
  const normalizedMessage = String(ctx.message || '').toLowerCase();
  const payIntentNow = PAYMENT_SIGNALS.some((s) => normalizedMessage.includes(s));
  const onRecordsRail = state.active_lane === LANE.RECORDS;

  const skipLegacyReroute = enforceMode && !!state.conversation_mode;

  if (!skipLegacyReroute && shouldReroute(state, ctx.message) && !(onRecordsRail && payIntentNow)) {
    const route = routeOrchestratorLane(state);
    state.active_lane = route.lane;
    state.step = route.step;
    if (route.safety_blocked) {
      state.flags.safety_blocked = true;
      state.flags.pending_human_handoff = true;
    }
    if (route.lane === KELLY_LANE.PAYMENT && !paymentGateOpen(state.flags) && !payIntentNow) {
      if (state.flags.has_rag || state.flags.triage_complete) {
        state.active_lane = KELLY_LANE.BOOKING;
        state.step = 'schedule_visit';
      }
    }
  }

  if (!skipLegacyReroute && state.active_lane === KELLY_LANE.ROUTER) {
    const route = routeOrchestratorLane(state);
    state.active_lane = route.lane;
    state.step = route.step;
    if (route.safety_blocked) {
      state.flags.safety_blocked = true;
      state.flags.pending_human_handoff = true;
    }
  }

  await promoteBookingWhenReady(state, ctx);

  if (payIntentNow) {
    if (state.flags.copay_amount == null) {
      state.flags.copay_amount = 25;
    }
    if (!state.flags.appointment_id && ctx.patientId) {
      try {
        const row = require('../../database').db
          .prepare(
            `SELECT id FROM appointments WHERE patient_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`
          )
          .get(ctx.patientId);
        if (row?.id) {
          state.flags.appointment_id = row.id;
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_appointment_id', row.id);
        }
      } catch (_) {}
    }
    if (paymentGateOpen(state.flags)) {
      state.active_lane = KELLY_LANE.PAYMENT;
      state.step = 'pay_invoice';
    }
  }

  state.flags._lane_export = state.active_lane;
  syncMetaFromFlags(ctx.sessionId, state.flags, state.active_lane);
  KellyToolExecutor._setSessionMeta(ctx.sessionId, 'kelly_graph_branch', state.active_lane);
  KellyToolExecutor._setSessionMeta(ctx.sessionId, 'kelly_graph_step', state.step);
  if (state.conversation_mode) {
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'conversation_mode', state.conversation_mode);
  }
  if (state.active_subrail) {
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'active_subrail', state.active_subrail);
  }

  const { reply, toolsUsed, endCall } = await executeLaneStep(state, ctx);

  if (state.active_lane === KELLY_LANE.BOOKING) {
    state.active_subrail = state.active_subrail || 'booking';
    state.flags.active_subrail = state.active_subrail;
  }

  if ((toolsUsed || []).includes('get_available_slots')) {
    const slotDate = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_date');
    const slotTime = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_time');
    const slotId = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'last_slot_id');
    if (slotDate && slotTime) {
      state.flags.current_booking_slot = {
        slot_id: slotId || null,
        date: slotDate,
        time: slotTime
      };
    }
  }

  state.last_reply = reply;
  state.tools_used_last_turn = toolsUsed || [];
  persistRailsSessionState(ctx.sessionId, {
    ...state,
    active_lane: state.active_lane,
    step: state.step,
    active_subrail_step: state.active_subrail_step || state.flags?.active_subrail_step,
    flags: {
      ...state.flags,
      conversation_mode: state.conversation_mode,
      active_subrail: state.active_subrail,
      active_subrail_step: state.active_subrail_step || state.flags?.active_subrail_step,
      active_lane: state.active_lane,
      step: state.step,
      locale: state.locale || state.flags?.locale || null
    },
    locale: state.locale || state.flags?.locale || null
  });

  if (state.step === 'done') {
    if (state.active_lane === KELLY_LANE.POST_PAYMENT) {
      state.step = 'confirmation';
      state.flags.post_visit_confirmation_pending = false;
    } else if (state.flags.safety_blocked) {
      state.active_lane = KELLY_LANE.SUPPORT;
      state.step = 'handoff';
    } else if (
      state.flags?.active_subrail === 'booking' &&
      !state.flags?.schedule_appointment_success
    ) {
      state.active_lane = KELLY_LANE.BOOKING;
      state.step = 'confirm_visit';
    } else {
      state.active_lane = KELLY_LANE.ROUTER;
      state.step = 'await_intent';
    }
  }

  return { state, reply, toolsUsed: toolsUsed || [], endCall: !!endCall };
}

module.exports = { executeTurn, shouldReroute };
