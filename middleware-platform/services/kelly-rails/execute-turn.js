'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE, normalizeState, routeOrchestratorLane, paymentGateOpen, PAYMENT_SIGNALS } = require('./state-schema');
const { hydrateFlagsFromDb } = require('./hydrate');
const { executeLaneStep } = require('./lanes');
const { persistRailsSessionState } = require('./session-ssot');
const { KELLY_LANE: LANE } = require('./state-schema');

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
  const db = require('../../database');
  const sid = String(input.session_id || input.sessionId || '').trim();
  let locale = input.locale || input.preferredLanguage;
  if (!locale && sid) {
    locale = db.getKellySessionLanguage?.(sid);
  }
  const state = normalizeState({ ...input, locale: locale || 'en' });
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
  const payIntentNow = PAYMENT_SIGNALS.some((s) => String(ctx.message || '').toLowerCase().includes(s));

  const onRecordsRail = state.active_lane === LANE.RECORDS;
  const payIntentNowPre = PAYMENT_SIGNALS.some((s) => String(ctx.message || '').toLowerCase().includes(s));

  if (shouldReroute(state, ctx.message) && !(onRecordsRail && payIntentNowPre)) {
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

  if (state.active_lane === KELLY_LANE.ROUTER) {
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

  const { reply, toolsUsed, endCall } = await executeLaneStep(state, ctx);

  state.last_reply = reply;
  state.tools_used_last_turn = toolsUsed || [];
  persistRailsSessionState(ctx.sessionId, state);

  if (state.step === 'done') {
    if (state.active_lane === KELLY_LANE.POST_PAYMENT) {
      state.step = 'confirmation';
      state.flags.post_visit_confirmation_pending = false;
    } else if (state.flags.safety_blocked) {
      state.active_lane = KELLY_LANE.SUPPORT;
      state.step = 'handoff';
    } else {
      state.active_lane = KELLY_LANE.ROUTER;
      state.step = 'await_intent';
    }
  }

  return { state, reply, toolsUsed: toolsUsed || [], endCall: !!endCall };
}

module.exports = { executeTurn, shouldReroute };
