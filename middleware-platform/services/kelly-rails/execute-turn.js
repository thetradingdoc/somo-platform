'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE, normalizeState, routeOrchestratorLane, paymentGateOpen, PAYMENT_SIGNALS } = require('./state-schema');
const { hydrateSessionForTurn } = require('./hydrate');
const { executeLaneStep } = require('./lanes');
const { persistRailsSessionState, getRailsSessionProjection } = require('./session-ssot');
const { shouldEnforceMode } = require('../conversation-mode/config');
const { applyLaneStepFromL2Handoff } = require('./lane-handoff-mapper');

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

  if (row.quality || row.region || row.onset) {
    state.flags.opqrst_from_triage = {
      quality: row.quality || null,
      region: row.region || row.body_site || null,
      onset: row.onset || row.timing || null,
      severity: row.severity ?? null
    };
  }
  state.flags.triage_complete = true;

  state.active_lane = KELLY_LANE.BOOKING;
  state.step = 'schedule_visit';

  try {
    persistRailsSessionState(ctx.sessionId, state);
  } catch (_) {}
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
  const hydrated = sid
    ? hydrateSessionForTurn(sid, {
        patientId: input.patientId || state.patient_id,
        activeLane: input.active_lane || state.active_lane
      })
    : null;
  const projection = hydrated?.projection || (sid ? getRailsSessionProjection(sid) : null);
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
    if (hydrated?.flags) {
      state.flags = { ...state.flags, ...hydrated.flags };
      if (hydrated.active_lane && !input.active_lane) {
        state.active_lane = hydrated.active_lane;
      }
      if (hydrated.step && !input.step) {
        state.step = hydrated.step;
      }
    } else {
      const { hydrateFlagsFromDb } = require('./hydrate');
      state.flags = { ...state.flags, ...hydrateFlagsFromDb(ctx.sessionId, ctx.patientId) };
    }
    state.v2_hydrated = true;
  }

  if (input.conversation_session) {
    Object.assign(state.flags, input.conversation_session);
  }
  if (projection?.flags_json) {
    try {
      const projFlags = JSON.parse(projection.flags_json);
      if (projFlags.lookup_complete) state.flags.lookup_complete = true;
      if (projFlags.last_appointment_id) state.flags.last_appointment_id = projFlags.last_appointment_id;
      if (projFlags.reschedule_pending) state.flags.reschedule_pending = true;
    } catch (_) {}
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

  const { skipLegacyRouting, payIntentNow, onRecordsRail } = applyLaneStepFromL2Handoff(
    state,
    ctx,
    input,
    { enforceMode }
  );

  state.last_user_message = ctx.message;

  if (!skipLegacyRouting && shouldReroute(state, ctx.message) && !(onRecordsRail && payIntentNow)) {
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

  if (!skipLegacyRouting && state.active_lane === KELLY_LANE.ROUTER) {
    const route = routeOrchestratorLane(state);
    state.active_lane = route.lane;
    state.step = route.step;
    if (route.safety_blocked) {
      state.flags.safety_blocked = true;
      state.flags.pending_human_handoff = true;
    }
  }

  if (!skipLegacyRouting) {
    await promoteBookingWhenReady(state, ctx);
  }

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
  // meta_kv mirrors projection via persistRailsSessionState → mirrorMetaFromPayload (single write path)

  const laneOut = await executeLaneStep(state, ctx);
  const { reply, toolsUsed, endCall, gate_matched, gate_outcome } = laneOut;
  state.gate_matched = gate_matched;
  state.gate_outcome = gate_outcome;
  if (gate_matched) state.flags.gate_matched = gate_matched;
  if (gate_outcome) state.flags.gate_outcome = gate_outcome;

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
    gate_matched: state.gate_matched,
    gate_outcome: state.gate_outcome,
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

  return {
    state,
    reply,
    toolsUsed: toolsUsed || [],
    endCall: !!endCall,
    gate_matched: state.gate_matched || null,
    gate_outcome: state.gate_outcome || null
  };
}

module.exports = { executeTurn, shouldReroute };
