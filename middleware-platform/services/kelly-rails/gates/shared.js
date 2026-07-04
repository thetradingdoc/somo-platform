'use strict';

const db = require('../../../database');
const KellyToolExecutor = require('../../kelly-tool-executor');
const { KELLY_LANE } = require('../state-schema');
const {
  getAllowedToolNames,
  isGateOwnedTransactionalStep,
  TRANSACTIONAL_GATE_TOOLS
} = require('../tool-allowlists');
const { parseSlotTimeFromMessage, normalizeSlotTime } = require('../slot-time-parse');

function assertDeterministicToolAllowed(lane, step, toolName, flags = {}) {
  if (isGateOwnedTransactionalStep(lane, step, flags) && TRANSACTIONAL_GATE_TOOLS.has(toolName)) {
    return;
  }
  const allowed = getAllowedToolNames(lane, step, flags);
  if (!allowed.includes(toolName)) {
    const msg = `[kelly-rails] deterministic tool ${toolName} not allowed for ${lane}/${step}`;
    if (process.env.NODE_ENV === 'test' || process.env.KELLY_RAILS_STRICT_TOOLS === '1') {
      throw new Error(msg);
    }
    console.warn(msg);
  }
}

async function executeDeterministicTool(lane, step, toolName, args, ctx) {
  assertDeterministicToolAllowed(lane, step, toolName);
  return KellyToolExecutor.execute(toolName, args, ctx);
}

function sessionRow(sessionId) {
  return db.getTriageSession ? db.getTriageSession(sessionId) : null;
}

function argsFromMeta(sessionId, key) {
  try {
    const v = KellyToolExecutor._getSessionMeta(sessionId, key);
    return v ? String(v) : null;
  } catch (_) {
    return null;
  }
}

function nextBusinessDayIso(offsetDays = 1) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nextWeekdayIso(targetDay, minDaysAhead = 1) {
  const d = new Date();
  d.setDate(d.getDate() + minDaysAhead);
  while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addBusinessDaysIso(startIso, businessDays) {
  const d = new Date(`${startIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return nextBusinessDayIso(businessDays);
  let added = 0;
  while (added < businessDays) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function isSyntheticSlotId(id) {
  return !id || String(id).startsWith('slot_');
}

function scheduleSucceeded(sched) {
  return !!(
    sched &&
    !sched.error &&
    sched.success !== false &&
    (sched.appointment?.id || sched.appointment_id || sched.id)
  );
}

function resolvePractitionerForProvider(providerName, clinicId) {
  if (!providerName || !clinicId) return null;
  try {
    const ProviderService = require('../../provider-service');
    const online = ProviderService.getOnlineProvidersForClinic(clinicId);
    const want = String(providerName).toLowerCase();
    const match = online.find((p) => {
      const dn = String(p.display_name || '').toLowerCase();
      return dn.includes(want) || want.split(/\s+/).filter(Boolean).every((part) => dn.includes(part));
    });
    return match?.provider_id || null;
  } catch (_) {
    return null;
  }
}

function parseNameFromMessage(message) {
  const m = String(message || '').match(/\bmy name is\s+([^,.\n]+)/i);
  return m ? m[1].trim() : null;
}

function resolveBookingSlot(state, ctx) {
  const slot = state.flags?.current_booking_slot || {};
  let apptDate = slot.date || argsFromMeta(ctx.sessionId, 'last_slot_date');
  let apptTime = normalizeSlotTime(slot.time) || normalizeSlotTime(argsFromMeta(ctx.sessionId, 'last_slot_time'));
  let slotId = slot.slot_id || argsFromMeta(ctx.sessionId, 'last_slot_id');
  const msg = String(ctx.message || '');
  const hadBoundSlot = !!(apptDate && apptTime);
  let confirmatory = false;
  try {
    const { isConfirmatoryUtterance } = require('../confirm-utterance');
    confirmatory = isConfirmatoryUtterance(msg);
  } catch (_) {}

  const dateInMsg = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const timeFromMsg = parseSlotTimeFromMessage(msg);
  if (dateInMsg) apptDate = dateInMsg[1];
  else if (/next week/i.test(msg) && !(hadBoundSlot && confirmatory)) apptDate = nextBusinessDayIso(7);
  else if (/tuesday|martes|вторник/i.test(msg) && !(hadBoundSlot && confirmatory)) {
    apptDate = nextWeekdayIso(2);
  }
  if (timeFromMsg) apptTime = timeFromMsg;
  else if (/afternoon|tarde|днём|днем/i.test(msg) && !(hadBoundSlot && confirmatory && apptTime)) {
    apptTime = '14:00';
  }
  if (apptTime && !apptDate) {
    apptDate =
      slot.date ||
      argsFromMeta(ctx.sessionId, 'last_slot_date') ||
      (/next week/i.test(msg) ? nextBusinessDayIso(7) : nextBusinessDayIso());
  }

  if (apptDate && apptTime) {
    state.flags.current_booking_slot = { slot_id: slotId || null, date: apptDate, time: apptTime };
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', apptDate);
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', apptTime);
    if (slotId) KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_id', String(slotId));
  }
  return { apptDate, apptTime, slotId, hasSlot: !!(apptDate && apptTime) };
}

function opqrstComplete(row, triagePolicyOrOpts) {
  const { opqrstComplete: gateComplete } = require('../../opqrst-field-gate');
  let triagePolicy = 'conditional';
  let specialty = row?.target_specialty || null;
  if (typeof triagePolicyOrOpts === 'string') {
    triagePolicy = triagePolicyOrOpts;
  } else if (triagePolicyOrOpts && typeof triagePolicyOrOpts === 'object') {
    triagePolicy = triagePolicyOrOpts.triagePolicy || triagePolicy;
    specialty = triagePolicyOrOpts.specialty ?? specialty;
  }
  return gateComplete(row, { triagePolicy, specialty });
}

function opqrstCompleteForSession(row, ctx = {}) {
  let triagePolicy = 'conditional';
  try {
    const db = require('../../database');
    const { loadTenantPolicyFromProfile } = require('../conversation-mode/tenant-policy');
    triagePolicy =
      loadTenantPolicyFromProfile(db, ctx.clinicId, ctx.customerId)?.triage_policy || 'conditional';
  } catch (_) {}
  return opqrstComplete(row, { triagePolicy, specialty: row?.target_specialty });
}

function formatApptWhen(appt) {
  return [appt?.date || appt?.appointment_date, appt?.time || appt?.appointment_time]
    .filter(Boolean)
    .join(' at ');
}

async function resolvePatientAppointment(state, ctx) {
  let apptId =
    state.flags.last_appointment_id ||
    state.flags.appointment_id ||
    state.flags.cancellation_context?.appointment_id ||
    argsFromMeta(ctx.sessionId, 'last_appointment_id');
  if (apptId) return { appointmentId: apptId, toolsUsed: [] };

  const toolsUsed = [];
  if (ctx.patientId && ctx.clinicId) {
    try {
      const rows =
        db.db
          ?.prepare(
            `SELECT * FROM appointments WHERE patient_id = ? AND clinic_id = ?
             AND (deleted_at IS NULL OR deleted_at = '')
             AND (status IS NULL OR status != 'cancelled')
             ORDER BY datetime(created_at) DESC LIMIT 5`
          )
          ?.all(ctx.patientId, ctx.clinicId) || [];
      if (rows.length) {
        const appt = rows[0];
        const id = appt.id || appt.appointment_id;
        state.flags.last_appointment_id = id;
        toolsUsed.push('search_appointments');
        return { appointmentId: id, appointment: appt, toolsUsed };
      }
    } catch (_) {}
  }

  const searchTerm = ctx.callerPhone || ctx.patientName || String(ctx.message || '').trim();
  if (searchTerm) {
    const results = await executeDeterministicTool(
      KELLY_LANE.RESCHEDULE,
      'find_booking',
      'search_appointments',
      { search_term: searchTerm, clinic_id: ctx.clinicId, patient_id: ctx.patientId },
      ctx
    );
    toolsUsed.push('search_appointments');
    const appts = Array.isArray(results?.appointments)
      ? results.appointments
      : Array.isArray(results?.results)
        ? results.results
        : [];
    const appt = appts[0];
    if (appt) {
      const id = appt.id || appt.appointment_id;
      state.flags.last_appointment_id = id;
      state.flags.lookup_complete = true;
      return { appointmentId: id, appointment: appt, toolsUsed };
    }
  }
  return { appointmentId: null, toolsUsed };
}

function parseRescheduleSlot(state, ctx) {
  const msg = String(ctx.message || '');
  const dateFromMsg = msg.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const timeFromMsg = msg.match(/\b(\d{1,2}:\d{2})\b/);
  const slot = state.flags.current_booking_slot || {};
  let newDate =
    dateFromMsg?.[1] || slot.date || argsFromMeta(ctx.sessionId, 'last_slot_date') || null;
  let newTime =
    timeFromMsg?.[1] || slot.time || argsFromMeta(ctx.sessionId, 'last_slot_time') || null;
  if (!newDate && /next week|próxima semana|следующ/i.test(msg)) {
    newDate = nextBusinessDayIso(7);
  }
  if (!newTime && newDate) {
    newTime = parseSlotTimeFromMessage(msg) || '09:00';
  }
  return { newDate, newTime };
}

function parseProviderFromMessage(message) {
  const msg = String(message || '');
  const drMatch = msg.match(
    /\b(?:dr\.?|doctor)\s+([A-Za-z][\sA-Za-z.-]{0,40}?)(?:\s+(?:at|on|for|works|tomorrow)\b|$)/i
  );
  if (drMatch) return drMatch[1].trim();
  const withMatch = msg.match(/\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (withMatch) return withMatch[1].trim();
  return null;
}

function bundleMatchesProvider(bundle, providerName) {
  if (!providerName) return true;
  const name = String(bundle.practitioner_name || bundle.provider || '').toLowerCase();
  const want = String(providerName).toLowerCase();
  return name.includes(want) || want.split(/\s+/).filter(Boolean).every((p) => name.includes(p));
}

function transitionToRebookBooking(state) {
  state.flags.cancel_complete = true;
  state.flags.cancel_pending = false;
  state.flags.cancel_find_pending = false;
  state.flags.cancel_confirmed = false;
  state.flags.lookup_complete = false;
  state.flags.reschedule_pending = false;
  state.flags.triage_complete = true;
  state.flags.has_rag = true;
  state.active_lane = KELLY_LANE.BOOKING;
  state.step = 'schedule_visit';
  state.active_subrail = 'booking';
  state.active_subrail_step = 'slot_lookup';
  state.conversation_mode = 'tenant_inbound_admin';
  state.flags.conversation_mode = 'tenant_inbound_admin';
}

module.exports = {
  db,
  KellyToolExecutor,
  KELLY_LANE,
  assertDeterministicToolAllowed,
  executeDeterministicTool,
  sessionRow,
  argsFromMeta,
  nextBusinessDayIso,
  nextWeekdayIso,
  addBusinessDaysIso,
  isSyntheticSlotId,
  scheduleSucceeded,
  resolvePractitionerForProvider,
  parseNameFromMessage,
  resolveBookingSlot,
  opqrstComplete,
  opqrstCompleteForSession,
  formatApptWhen,
  resolvePatientAppointment,
  parseRescheduleSlot,
  parseProviderFromMessage,
  bundleMatchesProvider,
  transitionToRebookBooking
};
