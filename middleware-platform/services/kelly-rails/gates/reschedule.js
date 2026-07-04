'use strict';

const KellyToolExecutor = require('../../kelly-tool-executor');
const { KELLY_LANE } = require('../state-schema');
const { GATE_OUTCOME } = require('../phase-enums');
const { getDeterministicReply } = require('../prompts/deterministic');
const { executeDeterministicTool, resolvePatientAppointment, parseRescheduleSlot } = require('./shared');

async function runDeterministicReschedule(state, ctx) {
  if (!state.flags?.reschedule_pending) return null;
  state.active_lane = KELLY_LANE.RESCHEDULE;
  state.step = 'move_or_cancel';

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

  const { newDate, newTime } = parseRescheduleSlot(state, ctx);
  if (!newDate || !newTime) {
    return {
      reply: getDeterministicReply('reschedule_need_slot', locale),
      toolsUsed,
      endCall: false,
      outcome: GATE_OUTCOME.FAILED
    };
  }

  const out = await executeDeterministicTool(
    KELLY_LANE.RESCHEDULE,
    'move_or_cancel',
    'reschedule_appointment',
    {
      appointment_id: appointmentId,
      new_date: newDate,
      new_time: newTime,
      clinic_id: ctx.clinicId
    },
    ctx
  );
  toolsUsed.push('reschedule_appointment');

  if (out?.success === false) {
    const slots = await KellyToolExecutor.execute(
      'get_available_slots',
      { date: newDate, specialty: 'Dental', days_ahead: 7 },
      ctx
    );
    if (slots && !slots.error) {
      const bundles = Array.isArray(slots.slot_bundles) ? slots.slot_bundles : [];
      const pick = bundles.find((b) => b.time) || bundles[0];
      if (pick) {
        const retry = await executeDeterministicTool(
          KELLY_LANE.RESCHEDULE,
          'move_or_cancel',
          'reschedule_appointment',
          {
            appointment_id: appointmentId,
            new_date: newDate,
            new_time: pick.time,
            clinic_id: ctx.clinicId
          },
          ctx
        );
        if (retry?.success !== false) {
          const when = [newDate, pick.time].filter(Boolean).join(' at ');
          state.flags.reschedule_complete = true;
          state.step = 'done';
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', newDate);
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', pick.time);
          return {
            reply: getDeterministicReply('appt_rescheduled', locale, { when }),
            toolsUsed: [...toolsUsed, 'get_available_slots'],
            endCall: false,
            outcome: GATE_OUTCOME.RESCHEDULED
          };
        }
      }
    }
    return {
      reply: getDeterministicReply('reschedule_failed', locale),
      toolsUsed,
      endCall: false,
      outcome: GATE_OUTCOME.FAILED
    };
  }

  const when = [newDate, newTime].filter(Boolean).join(' at ');
  state.flags.reschedule_complete = true;
  state.step = 'done';
  KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', newDate);
  KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', newTime);
  return {
    reply: getDeterministicReply('appt_rescheduled', locale, { when }),
    toolsUsed,
    endCall: false,
    outcome: GATE_OUTCOME.RESCHEDULED
  };
}

module.exports = { runDeterministicReschedule };
