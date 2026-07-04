'use strict';

const { KELLY_LANE } = require('../state-schema');
const { GATE_OUTCOME } = require('../phase-enums');
const { getDeterministicReply } = require('../prompts/deterministic');
const {
  executeDeterministicTool,
  resolvePatientAppointment,
  transitionToRebookBooking
} = require('./shared');

async function runDeterministicCancel(state, ctx) {
  if (state.active_lane !== KELLY_LANE.RESCHEDULE || state.step !== 'move_or_cancel') return null;
  if (!state.flags?.cancel_pending && !state.flags?.cancel_confirmed) return null;
  if (state.flags?.reschedule_pending) return null;

  const locale = state.locale || 'en';
  const { appointmentId, toolsUsed: lookupTools } = await resolvePatientAppointment(state, ctx);
  const toolsUsed = [...lookupTools];

  if (!appointmentId) {
    return {
      reply: getDeterministicReply('lookup_missing_id', locale),
      toolsUsed,
      endCall: false
    };
  }

  const out = await executeDeterministicTool(
    KELLY_LANE.RESCHEDULE,
    'move_or_cancel',
    'cancel_appointment',
    {
      appointment_id: appointmentId,
      reason: state.flags.cancellation_context?.reason || 'patient requested cancel',
      clinic_id: ctx.clinicId
    },
    ctx
  );
  toolsUsed.push('cancel_appointment');

  if (out?.success === false) {
    return {
      reply: getDeterministicReply('cancel_failed', locale),
      toolsUsed,
      endCall: false,
      outcome: GATE_OUTCOME.FAILED
    };
  }

  const wantsRebook =
    state.flags.rebook_after_cancel ||
    (Array.isArray(state.flags.pending_intent_queue) &&
      state.flags.pending_intent_queue.includes('book'));

  if (wantsRebook) {
    transitionToRebookBooking(state);
    return {
      reply: getDeterministicReply('cancel_then_rebook', locale),
      toolsUsed,
      endCall: false
    };
  }

  state.flags.cancel_complete = true;
  state.step = 'done';
  try {
    const db = require('../../../database');
    db.insertKellyCallEvent?.({
      session_id: ctx.sessionId,
      clinic_id: ctx.clinicId,
      event_type: 'appointment_cancelled',
      payload_json: {
        appointment_id: appointmentId,
        patient_id: ctx.patientId || null,
        clinic_id: ctx.clinicId || null
      }
    });
    const { sendPostCallOwnerEmail } = require('../../post-call-owner-email');
    sendPostCallOwnerEmail({
      eventType: 'appointment_cancelled',
      sessionId: ctx.sessionId,
      clinicId: ctx.clinicId,
      customerId: ctx.customerId,
      patientId: ctx.patientId,
      payload: { appointment_id: appointmentId }
    }).catch(() => {});
  } catch (_) {}
  return {
    reply: getDeterministicReply('appt_canceled', locale),
    toolsUsed,
    endCall: false,
    outcome: GATE_OUTCOME.CANCELLED
  };
}

module.exports = { runDeterministicCancel };
