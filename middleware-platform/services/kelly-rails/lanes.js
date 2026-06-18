'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE } = require('./state-schema');
const { GATE_OUTCOME } = require('./phase-enums');
const { runNodeStep } = require('./node-runner');
const {
  buildGateRegistry,
  runPreBookingGates,
  runBookingGates,
  shouldSkipLlm,
  skipLlmReply
} = require('./gate-registry');
const {
  runDeterministicSafety,
  runDeterministicPostPaymentConfirmation,
  runDeterministicPayment,
  runDeterministicRecords,
  runDeterministicApptLookup,
  runDeterministicReschedule,
  runDeterministicCancel,
  runDeterministicClinicalIntro,
  runDeterministicOpqrst,
  runDeterministicSchedule,
  runDeterministicBookingConflict
} = require('./gates');
const { sessionRow, argsFromMeta, opqrstComplete, transitionToRebookBooking } = require('./gates/shared');

const NEXT_STEP = {
  basic_intake: { identity: 'contact', contact: 'policy', policy: 'done' },
  clinical: {
    clinical_intake: 'medical_history',
    medical_history: 'medications',
    medications: 'symptoms',
    symptoms: 'triage_assessment',
    triage_assessment: 'done'
  },
  booking: { schedule_visit: 'confirm_visit', confirm_visit: 'done' },
  payment: { pay_invoice: 'insurance', insurance: 'receipt_logic', receipt_logic: 'done' },
  post_payment: { finish: 'scheduled', scheduled: 'confirmation', confirmation: 'done' },
  reschedule: { find_booking: 'move_or_cancel', move_or_cancel: 'done' },
  account: { billing: 'insurance', insurance: 'done' },
  records: { records_qa: 'fhir_read', fhir_read: 'done' },
  education: { education: 'clinical_advice', clinical_advice: 'done' },
  support: { faq: 'handoff', handoff: 'done' }
};

function advanceAfterStep(state, { outcome, toolsUsed = [] } = {}) {
  const lane = state.active_lane;
  const chain = NEXT_STEP[lane];
  if (!chain) return;

  const row = sessionRow(state.session_id);

  if (lane === KELLY_LANE.CLINICAL) {
    if (state.step === 'triage_assessment' && toolsUsed.includes('run_triage_rag')) {
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
      state.step = 'done';
      return;
    }
    if (state.step === 'symptoms' && opqrstComplete(row)) {
      state.step = 'triage_assessment';
      return;
    }
  }

  if (lane === KELLY_LANE.BOOKING && outcome === GATE_OUTCOME.BOOKED) {
    if (!state.flags.schedule_appointment_success && !state.flags.appointment_id) return;
    try {
      const { persistCaseSummaryForAppointment } = require('../case-summary-service');
      const apptId = KellyToolExecutor._getSessionMeta(state.session_id, 'last_appointment_id');
      if (apptId) {
        persistCaseSummaryForAppointment({
          appointmentId: apptId,
          sessionId: state.session_id
        });
        const { linkSessionToAppointment, persistRailsSessionState } = require('./session-ssot');
        linkSessionToAppointment(state.session_id, apptId);
        state.flags.appointment_id = apptId;
        state.flags.post_visit_confirmation_pending = true;
        KellyToolExecutor._setSessionMeta(state.session_id, 'post_visit_confirmation_pending', '1');
        persistRailsSessionState(state.session_id, state);
      }
    } catch (_) {}
    state.step = 'done';
    return;
  }

  if (lane === KELLY_LANE.BOOKING && toolsUsed.includes('get_available_slots') && state.step === 'schedule_visit') {
    const hasSlot =
      !!(state.flags.current_booking_slot?.date && state.flags.current_booking_slot?.time) ||
      !!(argsFromMeta(state.session_id, 'last_slot_date') && argsFromMeta(state.session_id, 'last_slot_time'));
    if (!state.flags.no_provider_availability && hasSlot) {
      state.step = 'confirm_visit';
    }
    return;
  }

  if (lane === KELLY_LANE.BOOKING && toolsUsed.includes('schedule_appointment')) {
    if (!state.flags.schedule_appointment_success) return;
    try {
      const { persistCaseSummaryForAppointment } = require('../case-summary-service');
      const apptId = KellyToolExecutor._getSessionMeta(state.session_id, 'last_appointment_id');
      if (apptId) {
        persistCaseSummaryForAppointment({
          appointmentId: apptId,
          sessionId: state.session_id
        });
        const { linkSessionToAppointment, persistRailsSessionState } = require('./session-ssot');
        linkSessionToAppointment(state.session_id, apptId);
        state.flags.appointment_id = apptId;
        state.flags.post_visit_confirmation_pending = true;
        KellyToolExecutor._setSessionMeta(state.session_id, 'post_visit_confirmation_pending', '1');
        persistRailsSessionState(state.session_id, state);
      }
    } catch (_) {}
    state.step = 'done';
    return;
  }

  if (lane === KELLY_LANE.RESCHEDULE && outcome === GATE_OUTCOME.CANCELLED) {
    state.step = 'done';
    return;
  }

  if (lane === KELLY_LANE.RESCHEDULE && outcome === GATE_OUTCOME.RESCHEDULED) {
    state.step = 'done';
    return;
  }

  if (lane === KELLY_LANE.PAYMENT && toolsUsed.includes('request_patient_payment')) {
    state.step = 'insurance';
    return;
  }

  if (lane === KELLY_LANE.BASIC_INTAKE && state.step === 'policy') {
    state.flags.basic_intake_complete = true;
    KellyToolExecutor._setSessionMeta(state.session_id, 'basic_intake_complete', '1');
  }

  if (lane === KELLY_LANE.SUPPORT && state.step === 'handoff') {
    state.flags.pending_human_handoff = true;
    KellyToolExecutor._setSessionMeta(state.session_id, 'pending_human_handoff', '1');
  }

  if (lane === KELLY_LANE.SUPPORT && state.step === 'handoff' && state.flags.safety_blocked) {
    return;
  }

  if (lane === KELLY_LANE.RESCHEDULE && state.step === 'find_booking') {
    if (state.flags?.appt_lookup_only) return;
    if (state.flags?.cancel_find_pending && !state.flags?.cancel_pending && !state.flags?.reschedule_pending) {
      return;
    }
  }

  const next = chain[state.step];
  if (next) state.step = next;
}

async function executeLaneStep(state, ctx) {
  const registry = buildGateRegistry({
    runDeterministicSafety,
    runDeterministicPostPaymentConfirmation,
    runDeterministicPayment,
    runDeterministicRecords,
    runDeterministicApptLookup,
    runDeterministicReschedule,
    runDeterministicCancel,
    runDeterministicClinicalIntro,
    runDeterministicOpqrst,
    runDeterministicSchedule,
    runDeterministicBookingConflict
  });

  const pre = await runPreBookingGates(registry, state, ctx, advanceAfterStep);
  if (pre) {
    return {
      ...pre.result,
      gate_matched: pre.gateId,
      gate_outcome: pre.result?.outcome || GATE_OUTCOME.HANDLED
    };
  }

  const rowAfter = sessionRow(ctx.sessionId);
  if (
    state.active_lane === KELLY_LANE.CLINICAL &&
    opqrstComplete(rowAfter) &&
    !state.flags.has_rag &&
    !rowAfter?.rag_result_id
  ) {
    const rag = await KellyToolExecutor.execute('run_triage_rag', {}, ctx);
    if (rag && !rag.error) {
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
      state.step = 'done';
    }
  }

  const booking = await runBookingGates(registry, state, ctx, advanceAfterStep);
  if (booking) {
    return {
      ...booking.result,
      gate_matched: booking.gateId,
      gate_outcome: booking.result?.outcome || GATE_OUTCOME.HANDLED
    };
  }

  if (shouldSkipLlm(state)) {
    const skip = skipLlmReply(state);
    return { ...skip, gate_matched: null, gate_outcome: GATE_OUTCOME.GATE_PROCESSING };
  }

  const result = await runNodeStep(state, ctx);
  advanceAfterStep(state, { outcome: result.outcome, toolsUsed: result.toolsUsed || [] });
  return { ...result, gate_matched: null, gate_outcome: GATE_OUTCOME.LLM };
}

module.exports = {
  executeLaneStep,
  advanceAfterStep,
  NEXT_STEP,
  runDeterministicSafety,
  runDeterministicPostPaymentConfirmation,
  runDeterministicPayment,
  runDeterministicRecords,
  runDeterministicCancel,
  runDeterministicReschedule,
  runDeterministicApptLookup,
  runDeterministicBookingConflict,
  runDeterministicSchedule,
  transitionToRebookBooking
};
