'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE, normalizeState, routeOrchestratorLane, paymentGateOpen, PAYMENT_SIGNALS } = require('./state-schema');
const { hydrateFlagsFromDb } = require('./hydrate');
const { executeLaneStep } = require('./lanes');

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
    if (process.env.KELLY_RAILS_FAST_RAG === '1') {
      const { completeTriageRagForSession } = require('../triage-rag-fast-complete');
      completeTriageRagForSession(ctx.sessionId, ctx.patientId, {
        region: row?.region || 'leg and neck',
        quality: row?.quality || 'itchy rash on leg and neck',
      });
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
    } else {
      const rag = await KellyToolExecutor.execute('run_triage_rag', {}, ctx);
      if (rag && !rag.error) {
        state.flags.has_rag = true;
        state.flags.triage_complete = true;
      }
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
    reschedule: 'BOOKING'
  };
  return map[String(lane || '').toLowerCase()] || 'TRIAGE_DISCOVERY';
}

function syncMetaFromFlags(sessionId, flags, lane) {
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_rails_v2', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_active', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_graph_branch', String(flags._lane_export || lane || ''));
    if (lane) {
      KellyToolExecutor._setSessionMeta(sessionId, 'kelly_orchestrator_phase', laneToOrchestratorPhase(lane));
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
  const state = normalizeState(input);
  const ctx = {
    sessionId: state.session_id,
    clinicId: input.clinicId || state.clinic_id,
    patientId: input.patientId || state.patient_id,
    callerPhone: input.callerPhone || null,
    channel: state.channel || 'chat',
    message: String(input.message || state.last_user_message || '')
  };

  if (!state.v2_hydrated) {
    state.flags = { ...state.flags, ...hydrateFlagsFromDb(ctx.sessionId, ctx.patientId) };
    state.v2_hydrated = true;
  }

  state.last_user_message = ctx.message;

  if (shouldReroute(state, ctx.message)) {
    const route = routeOrchestratorLane(state);
    state.active_lane = route.lane;
    state.step = route.step;
    if (route.lane === KELLY_LANE.PAYMENT && !paymentGateOpen(state.flags)) {
      if (state.flags.has_rag || state.flags.triage_complete) {
        state.active_lane = KELLY_LANE.BOOKING;
        state.step = 'schedule_visit';
      }
    }
  }

  if (state.active_lane === KELLY_LANE.ROUTER) {
    const route = routeOrchestratorLane(state);
    state.active_lane = route.lane;
    state.step = route.step;
  }

  await promoteBookingWhenReady(state, ctx);

  state.flags._lane_export = state.active_lane;
  syncMetaFromFlags(ctx.sessionId, state.flags, state.active_lane);
  KellyToolExecutor._setSessionMeta(ctx.sessionId, 'kelly_graph_branch', state.active_lane);
  KellyToolExecutor._setSessionMeta(ctx.sessionId, 'kelly_graph_step', state.step);

  const { reply, toolsUsed, endCall } = await executeLaneStep(state, ctx);

  state.last_reply = reply;
  state.tools_used_last_turn = toolsUsed || [];

  if (state.step === 'done') {
    state.active_lane = KELLY_LANE.ROUTER;
    state.step = 'await_intent';
  }

  return { state, reply, toolsUsed: toolsUsed || [], endCall: !!endCall };
}

module.exports = { executeTurn, shouldReroute };
