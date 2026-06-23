'use strict';

const { KELLY_LANE } = require('../state-schema');
const { getDeterministicReply } = require('../prompts/deterministic');
const { executeDeterministicTool, formatApptWhen } = require('./shared');

async function runDeterministicApptLookup(state, ctx) {
  if (state.flags?.appt_lookup_only) {
    state.active_lane = KELLY_LANE.RESCHEDULE;
    state.step = 'find_booking';
  }

  if (state.active_lane !== KELLY_LANE.RESCHEDULE || state.step !== 'find_booking') return null;

  const subrail = state.active_subrail || state.flags?.active_subrail;
  const lookupActive =
    state.flags?.appt_lookup_only ||
    state.flags?.cancel_find_pending ||
    subrail === 'cancellation';
  if (!lookupActive) return null;

  const locale = state.locale || 'en';
  const toolsUsed = [];
  let results = null;

  if (ctx.patientId && ctx.clinicId) {
    try {
      const dbMod = require('../../../../database');
      const rows =
        dbMod.db
          ?.prepare(
            `SELECT * FROM appointments WHERE patient_id = ? AND clinic_id = ?
             AND (deleted_at IS NULL OR deleted_at = '')
             ORDER BY datetime(created_at) DESC LIMIT 5`
          )
          ?.all(ctx.patientId, ctx.clinicId) || [];
      if (rows.length) {
        results = { success: true, appointments: rows };
        toolsUsed.push('search_appointments');
      }
    } catch (_) {}
  }

  const searchTerm =
    ctx.callerPhone ||
    ctx.patientName ||
    String(ctx.message || '').trim();
  if (!results && searchTerm) {
    results = await executeDeterministicTool(
      KELLY_LANE.RESCHEDULE,
      'find_booking',
      'search_appointments',
      { search_term: searchTerm, clinic_id: ctx.clinicId, patient_id: ctx.patientId },
      ctx
    );
    toolsUsed.push('search_appointments');
  }

  if (!results) {
    return {
      reply: getDeterministicReply('lookup_missing_id', locale),
      toolsUsed,
      endCall: false
    };
  }

  const appts = Array.isArray(results?.appointments)
    ? results.appointments
    : Array.isArray(results?.results)
      ? results.results
      : [];
  const appt = appts[0];
  if (appt) {
    const when = formatApptWhen(appt);
    const type = appt.appointment_type || appt.specialty || 'appointment';
    state.flags.last_appointment_id = appt.id || appt.appointment_id;
    state.flags.lookup_complete = true;
    if (state.flags.reschedule_pending && !state.flags.cancel_pending) {
      state.step = 'move_or_cancel';
    }
    return {
      reply: when
        ? getDeterministicReply('appt_found', locale, { type, when })
        : getDeterministicReply('appt_found_short', locale, { type }),
      toolsUsed,
      endCall: false
    };
  }

  return {
    reply: getDeterministicReply('lookup_not_found', locale),
    toolsUsed,
    endCall: false
  };
}

module.exports = { runDeterministicApptLookup };
