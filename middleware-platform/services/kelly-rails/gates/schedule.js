'use strict';

const KellyToolExecutor = require('../../kelly-tool-executor');
const { KELLY_LANE } = require('../state-schema');
const { GATE_OUTCOME } = require('../phase-enums');
const { getDeterministicReply } = require('../prompts/deterministic');
const { isConfirmatoryUtterance, passesLocalizedBookConfirm } = require('../confirm-utterance');
const { parseSlotTimeFromMessage, normalizeSlotTime } = require('../slot-time-parse');
const { emitBookingOutcome } = require('../booking-outcome');
const { readAppointmentRowById, formatAppointmentWhen } = require('../appointment-read');
const {
  sessionRow,
  argsFromMeta,
  nextBusinessDayIso,
  addBusinessDaysIso,
  isSyntheticSlotId,
  scheduleSucceeded,
  resolvePractitionerForProvider,
  parseNameFromMessage,
  resolveBookingSlot,
  opqrstComplete,
  parseProviderFromMessage,
  bundleMatchesProvider,
  executeDeterministicTool
} = require('./shared');

function execScheduleTool(state, toolName, args, ctx) {
  const lane = state.active_lane || KELLY_LANE.BOOKING;
  const step = state.step || 'schedule_visit';
  return executeDeterministicTool(lane, step, toolName, args, ctx);
}

function resolveScheduleSpecialty(ctx, row) {
  const visit =
    argsFromMeta(ctx.sessionId, 'fd_reason_for_visit') ||
    argsFromMeta(ctx.sessionId, 'reason_for_visit') ||
    argsFromMeta(ctx.sessionId, 'visit_reason');
  if (visit && /clean|dental|dentist|hygien/i.test(String(visit))) return 'Dental';
  if (row?.target_specialty) return row.target_specialty;
  const target = argsFromMeta(ctx.sessionId, 'target_specialty');
  if (target) return String(target);
  return 'Dental';
}

function specialtyTimesLabel(specialty) {
  const s = String(specialty || 'Dental');
  if (/dental/i.test(s)) return 'dental';
  return s.toLowerCase();
}

async function runDeterministicSchedule(state, ctx) {
  const toolsUsed = [];
  const { frontDeskIntakeComplete, isFrontDeskTenant, promptForField, nextFrontDeskField } = require('../../front-desk-intake');
  if (isFrontDeskTenant(ctx) && !frontDeskIntakeComplete(ctx.sessionId)) {
    const field = nextFrontDeskField(ctx.sessionId);
    return {
      reply: promptForField(field || 'full_name', state.locale || ctx.locale || 'en'),
      endCall: false
    };
  }
  const row = sessionRow(ctx.sessionId);
  if (!row?.rag_result_id && opqrstComplete(row)) {
    const rag = await execScheduleTool(state, 'run_triage_rag', {}, ctx);
    if (rag && !rag.error) {
      toolsUsed.push('run_triage_rag');
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
    }
  }

  const msg = String(ctx.message || '').toLowerCase();
  const resolved = resolveBookingSlot(state, ctx);
  let apptDateFromSlot = resolved.apptDate;
  let apptTimeFromSlot = resolved.apptTime;
  let slotIdFromSlot = resolved.slotId;
  const hasBookingSlot = resolved.hasSlot;
  const confirmatory = isConfirmatoryUtterance(ctx.message);
  const conflictActive = !!(state.flags?.booking_conflict || state.flags?.provider_mismatch);

  const onBookingPath =
    state.active_lane === KELLY_LANE.BOOKING ||
    state.active_subrail === 'booking' ||
    state.flags?.active_subrail === 'booking' ||
    argsFromMeta(ctx.sessionId, 'slots_offered') === '1' ||
    !!(argsFromMeta(ctx.sessionId, 'last_slot_date') && argsFromMeta(ctx.sessionId, 'last_slot_time'));

  const slotsOffered =
    state.flags?.slots_offered ||
    argsFromMeta(ctx.sessionId, 'slots_offered') === '1' ||
    hasBookingSlot;
  const nameFromMsgEarly = parseNameFromMessage(ctx.message);
  if (onBookingPath && slotsOffered && nameFromMsgEarly && !confirmatory) {
    try {
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'collected_name', nameFromMsgEarly);
    } catch (_) {}
    state.flags.slots_offered = true;
    state.step = 'confirm_visit';
    return {
      reply: getDeterministicReply('slot_confirm_contact', state.locale || 'en'),
      toolsUsed,
      endCall: false
    };
  }

  const wantsBookConfirm =
    onBookingPath &&
    (state.step === 'confirm_visit' ||
      (hasBookingSlot && confirmatory) ||
      ((state.flags?.slots_offered ||
        argsFromMeta(ctx.sessionId, 'slots_offered') === '1' ||
        (argsFromMeta(ctx.sessionId, 'last_slot_date') &&
          argsFromMeta(ctx.sessionId, 'last_slot_time'))) &&
        confirmatory) ||
      (conflictActive && hasBookingSlot && confirmatory) ||
      /@|please book|works for me|funciona|me funciona|me viene bien|reservar|por favor|хорошо|подходит|да\b|martes|tarde|вторник|днём|днем|周二|12点|可以|预约/.test(msg));

  if (onBookingPath && wantsBookConfirm && passesLocalizedBookConfirm(ctx.message)) {
    const existingApptId =
      state.flags.last_appointment_id ||
      state.flags.appointment_id ||
      argsFromMeta(ctx.sessionId, 'last_appointment_id');
    if (state.flags.schedule_appointment_success || existingApptId) {
      let when = '';
      if (existingApptId) {
        const apptRow = readAppointmentRowById(existingApptId);
        if (apptRow) when = formatAppointmentWhen(apptRow);
      }
      if (!when) {
        when = [
          argsFromMeta(ctx.sessionId, 'last_slot_date'),
          argsFromMeta(ctx.sessionId, 'last_slot_time')
        ]
          .filter(Boolean)
          .join(' at ');
      }
      return {
        reply: getDeterministicReply('booking_confirmed', state.locale || 'en', {
          when: when || 'your selected time'
        }),
        toolsUsed: [],
        endCall: false,
        outcome: GATE_OUTCOME.BOOKED
      };
    }

    const emailMatch = String(ctx.message || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
    const nameFromMsg = parseNameFromMessage(ctx.message);
    if (nameFromMsg) {
      try {
        KellyToolExecutor._setSessionMeta(ctx.sessionId, 'collected_name', nameFromMsg);
      } catch (_) {}
    }
    let slotId = slotIdFromSlot;
    let apptDate = apptDateFromSlot;
    let apptTime = apptTimeFromSlot;
    if (isSyntheticSlotId(slotId)) slotId = null;
    if (!slotId && !(apptDate && apptTime)) {
      const slots = await execScheduleTool(
        state,
        'get_available_slots',
        { specialty: resolveScheduleSpecialty(ctx, row) || 'Dental', days_ahead: 14 },
        ctx
      );
      const bundles = Array.isArray(slots?.slot_bundles) ? slots.slot_bundles : [];
      const pick =
        bundles.find((b) => String(b.time || '').startsWith('12:00')) ||
        bundles[0] ||
        null;
      if (!pick && bundles.length === 0) {
        state.flags.no_provider_availability = true;
        emitBookingOutcome(ctx.sessionId, 'no_availability', { gate: 'schedule' });
        return {
          reply: getDeterministicReply('slots_empty', state.locale || 'en'),
          toolsUsed: [...toolsUsed, 'get_available_slots'],
          endCall: false
        };
      }
      if (pick) {
        slotId = pick.id || pick.slot_id || pick.practitioner_id;
        apptDate =
          pick.date ||
          (() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return d.toISOString().slice(0, 10);
          })();
        apptTime = pick.time || '12:00';
        if (slotId) KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_id', String(slotId));
        KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', apptDate);
        KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', apptTime);
        toolsUsed.push('get_available_slots');
      }
    }
    if (!apptDate || !apptTime) {
      const providerPrefEarly =
        state.flags.provider_preference || parseProviderFromMessage(ctx.message);
      if (providerPrefEarly) {
        const slotsProbe = await execScheduleTool(
          state,
          'get_available_slots',
          { specialty: resolveScheduleSpecialty(ctx, row) || 'Dental', days_ahead: 14 },
          ctx
        );
        const probeBundles = Array.isArray(slotsProbe?.slot_bundles) ? slotsProbe.slot_bundles : [];
        if (probeBundles.length) {
          toolsUsed.push('get_available_slots');
          const matched = probeBundles.filter((b) => bundleMatchesProvider(b, providerPrefEarly));
          if (!matched.length) {
            state.flags.provider_preference = providerPrefEarly;
            state.flags.provider_mismatch = true;
            state.flags.booking_conflict = true;
            state.flags._conflict_slot_bundles = probeBundles.slice(0, 3);
            return { reply: null, toolsUsed, endCall: false };
          }
        }
      }
      return {
        reply:
          'I need to confirm an available time before I can book. Which date and time work best for you?',
        toolsUsed,
        endCall: false
      };
    }
    const providerPref =
      state.flags.provider_preference || parseProviderFromMessage(ctx.message);
    if (providerPref) state.flags.provider_preference = providerPref;

    apptTime = normalizeSlotTime(apptTime) || apptTime;
    state.flags.booking_conflict = false;
    state.flags.provider_mismatch = false;

    let practitionerId = slotId;
    if (!practitionerId && providerPref) {
      practitionerId = resolvePractitionerForProvider(providerPref, ctx.clinicId);
    }

    const specialty = resolveScheduleSpecialty(ctx, row);
    const scheduleBase = {
      patient_id: ctx.patientId,
      specialty,
      appointment_type: specialty,
      patient_name:
        nameFromMsg ||
        argsFromMeta(ctx.sessionId, 'collected_name') ||
        ctx.patientName ||
        'Patient',
      patient_email: emailMatch ? emailMatch[0] : argsFromMeta(ctx.sessionId, 'collected_email') || undefined,
      patient_phone: ctx.callerPhone,
      session_id: ctx.sessionId,
      practitioner_id: practitionerId || undefined,
      slot_id: practitionerId || undefined
    };

    let sched = null;
    let bookedDate = apptDate;
    let bookedTime = apptTime;
    for (let attempt = 0; attempt < 21; attempt++) {
      const tryDate = attempt === 0 ? apptDate : addBusinessDaysIso(apptDate, attempt);
      sched = await execScheduleTool(
        state,
        'schedule_appointment',
        {
          ...scheduleBase,
          date: tryDate,
          time: apptTime,
          appointment_date: tryDate,
          appointment_time: apptTime
        },
        ctx
      );
      if (scheduleSucceeded(sched)) {
        bookedDate = tryDate;
        bookedTime = apptTime;
        break;
      }
      const err = String(sched?.error || sched?.message || '');
      if (!/not available|conflict|outside business|slot|unavailable/i.test(err)) break;
      bookedDate = tryDate;
    }
    toolsUsed.push('schedule_appointment');

    if (scheduleSucceeded(sched)) {
      const apptId = sched.appointment?.id || sched.appointment_id || sched.id;
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_appointment_id', apptId);
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', bookedDate);
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', bookedTime);
      state.flags.schedule_appointment_success = true;
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'schedule_appointment_success', '1');
      if (state.flags.copay_amount == null) {
        const metaCopay = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'copay_amount');
        if (metaCopay != null && Number.isFinite(Number(metaCopay))) {
          state.flags.copay_amount = Number(metaCopay);
        }
      }
      state.flags.appointment_id = apptId;
      state.flags.booking_conflict = false;
      state.flags.provider_mismatch = false;
      state.step = 'done';
      try {
        const { persistCaseSummaryForAppointment } = require('../../case-summary-service');
        persistCaseSummaryForAppointment({ appointmentId: apptId, sessionId: ctx.sessionId });
      } catch (_) {}
      state.flags.post_visit_confirmation_pending = true;
      try {
        KellyToolExecutor._setSessionMeta(ctx.sessionId, 'post_visit_confirmation_pending', '1');
      } catch (_) {}
      const when = [sched.appointment?.date || sched.date || bookedDate, sched.appointment?.time || sched.time || bookedTime]
        .filter(Boolean)
        .join(' at ');
      emitBookingOutcome(ctx.sessionId, 'booked', {
        appointment_id: apptId,
        date: bookedDate,
        time: bookedTime,
        gate: 'schedule'
      });
      return {
        reply: getDeterministicReply('booking_confirmed', state.locale || 'en', { when }),
        toolsUsed,
        endCall: false,
        outcome: GATE_OUTCOME.BOOKED
      };
    }
    state.flags.booking_conflict = true;
    state.flags.last_schedule_error = sched?.error || sched?.message || 'slot_unavailable';
    if (sched?.alternative_slots) state.flags.alternative_slots = sched.alternative_slots;
    const errText = String(sched?.error || sched?.message || '');
    const isConflict = /not available|conflict|unavailable|outside business|slot/i.test(errText);
    emitBookingOutcome(ctx.sessionId, isConflict ? 'schedule_conflict' : 'schedule_failed', {
      error_code: sched?.error || sched?.message || 'slot_unavailable',
      gate: 'schedule'
    });
    return {
      reply: isConflict
        ? getDeterministicReply('slot_conflict', state.locale || 'en', {
            slots: 'another day or time'
          })
        : getDeterministicReply('schedule_failed', state.locale || 'en'),
      toolsUsed,
      endCall: false
    };
  }

  if (state.active_lane === KELLY_LANE.BOOKING && state.step === 'schedule_visit' && !/@/.test(msg)) {
    if (confirmatory && hasBookingSlot) {
      return null;
    }
    if (hasBookingSlot && wantsBookConfirm) {
      return null;
    }
    if (
      /schedule|appointment|slot|tomorrow|noon|12:00|available|check|next week|works for me|cleaning|cita|limpieza|запис|tuesday|afternoon|tarde|martes|вторник|осмотр|приём|прием|днём|днем/.test(
        msg
      )
    ) {
      const specialty = resolveScheduleSpecialty(ctx, row);
      const slots = await execScheduleTool(
        state,
        'get_available_slots',
        { specialty, days_ahead: 14, appointment_type: specialty },
        ctx
      );
      if (slots && !slots.error) {
        toolsUsed.push('get_available_slots');
        const bundles = Array.isArray(slots.slot_bundles) ? slots.slot_bundles : [];
        if (!bundles.length) {
          const explicitTime = parseSlotTimeFromMessage(ctx.message);
          if (explicitTime) {
            const slotDate = nextBusinessDayIso();
            KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', slotDate);
            KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', explicitTime);
            state.flags.current_booking_slot = { slot_id: null, date: slotDate, time: explicitTime };
            state.step = 'confirm_visit';
            return {
              reply: getDeterministicReply('slot_confirm_contact', state.locale || 'en'),
              toolsUsed,
              endCall: false
            };
          }
          state.flags.no_provider_availability = true;
          emitBookingOutcome(ctx.sessionId, 'no_availability', { gate: 'schedule' });
          return {
            reply: getDeterministicReply('slots_empty', state.locale || 'en'),
            toolsUsed,
            endCall: false,
            outcome: GATE_OUTCOME.NO_AVAILABILITY
          };
        }
        const preview = bundles.filter((b) => /12:00|12:15|09:00/.test(String(b.time || ''))).slice(0, 3);
        const lines = preview.map((b) => `• ${b.time} (${b.practitioner_name || 'provider'})`);
        const pick =
          bundles.find((b) => String(b.time || '').startsWith('12:00')) || bundles[0];
        if (pick) {
          const sid = pick.id || pick.slot_id || pick.practitioner_id;
          if (sid) KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_id', String(sid));
          const slotDate =
            pick.date ||
            (() => {
              const d = new Date();
              d.setDate(d.getDate() + 1);
              return d.toISOString().slice(0, 10);
            })();
          const slotTime = String(pick.time || '12:00');
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', slotDate);
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', slotTime);
          state.flags.current_booking_slot = { slot_id: sid, date: slotDate, time: slotTime };
        }
        const reply =
          lines.length > 0
            ? getDeterministicReply('slots_preview', state.locale || 'en', {
                specialty: specialtyTimesLabel(specialty),
                slots: lines.join('\n')
              })
            : getDeterministicReply('slots_offered', state.locale || 'en');
        return { reply, toolsUsed, endCall: false };
      }
    }
  }

  if (state.active_lane !== KELLY_LANE.BOOKING || state.step !== 'confirm_visit') {
    return toolsUsed.length ? { reply: null, toolsUsed, endCall: false, _continue: true } : null;
  }
  return null;
}

module.exports = { runDeterministicSchedule };
