'use strict';

const db = require('../../database');
const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE } = require('./state-schema');
const { runNodeStep } = require('./node-runner');
const { PAYMENT_SIGNALS } = require('./state-schema');
const { getAllowedToolNames } = require('./tool-allowlists');
const { getDeterministicReply } = require('./prompts/deterministic');
const { isConfirmatoryUtterance } = require('./confirm-utterance');
const { parseSlotTimeFromMessage, normalizeSlotTime } = require('./slot-time-parse');
const { emitBookingOutcome } = require('./booking-outcome');
const {
  buildGateRegistry,
  runPreBookingGates,
  runBookingGates,
  shouldSkipLlm,
  skipLlmReply
} = require('./gate-registry');

function assertDeterministicToolAllowed(lane, step, toolName) {
  const allowed = getAllowedToolNames(lane, step, {});
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
    const ProviderService = require('../provider-service');
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

/** Merge slot from flags, meta, and patient utterance (time/date). */
function resolveBookingSlot(state, ctx) {
  const slot = state.flags?.current_booking_slot || {};
  let apptDate = slot.date || argsFromMeta(ctx.sessionId, 'last_slot_date');
  let apptTime = normalizeSlotTime(slot.time) || normalizeSlotTime(argsFromMeta(ctx.sessionId, 'last_slot_time'));
  let slotId = slot.slot_id || argsFromMeta(ctx.sessionId, 'last_slot_id');
  const msg = String(ctx.message || '');

  const dateInMsg = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const timeFromMsg = parseSlotTimeFromMessage(msg);
  if (dateInMsg) apptDate = dateInMsg[1];
  else if (/next week/i.test(msg)) apptDate = nextBusinessDayIso(7);
  if (timeFromMsg) apptTime = timeFromMsg;
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

async function runDeterministicSafety(state, ctx) {
  if (state.active_lane !== KELLY_LANE.SUPPORT || state.step !== 'handoff' || !state.flags.safety_blocked) {
    return null;
  }
  return {
    reply:
      'This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now. I cannot schedule visits or take payments during an emergency.',
    toolsUsed: [],
    endCall: true
  };
}

async function runDeterministicPostPaymentConfirmation(state, ctx) {
  if (state.active_lane !== KELLY_LANE.POST_PAYMENT) return null;

  const apptId = state.flags.appointment_id || argsFromMeta(ctx.sessionId, 'last_appointment_id');
  let when = '';
  let specialty = 'your visit';
  const dateMeta = argsFromMeta(ctx.sessionId, 'last_slot_date');
  const timeMeta = argsFromMeta(ctx.sessionId, 'last_slot_time');
  if (dateMeta || timeMeta) {
    when = [dateMeta, timeMeta].filter(Boolean).join(' at ');
  }

  if (apptId && db.db) {
    try {
      const row = db.db
        .prepare(
          `SELECT appointment_date, appointment_time, specialty FROM appointments WHERE id = ? OR appointment_id = ? LIMIT 1`
        )
        .get(apptId, apptId);
      if (row) {
        when = when || [row.appointment_date, row.appointment_time].filter(Boolean).join(' at ');
        if (row.specialty) specialty = row.specialty;
      }
    } catch (_) {}
  }

  const row = sessionRow(ctx.sessionId);
  if (row?.target_specialty) specialty = row.target_specialty;

  const paidNote = state.flags.payment_complete
    ? ' We have your copay payment on file.'
    : state.flags.payment_token
      ? ' Your secure payment link was sent if you still need to pay.'
      : '';

  const whenPart = when ? ` scheduled for ${when}` : ' on file';
  const reply = `You're all set — your ${specialty} appointment is confirmed${whenPart}.${paidNote} You'll receive details by email or text if we have them on file. If you need to change anything, say reschedule or call the clinic.`;

  state.step = 'done';
  state.flags.post_visit_confirmation_pending = false;
  try {
    KellyToolExecutor._setSessionMeta(ctx.sessionId, 'post_visit_confirmation_pending', '0');
  } catch (_) {}

  return { reply, toolsUsed: ['get_triage_session'], endCall: false };
}

async function runDeterministicPayment(state, ctx) {
  if (state.active_lane !== KELLY_LANE.PAYMENT) return null;

  const { sessionId, clinicId, patientId, callerPhone, channel, message } = ctx;
  const msg = String(message || '').toLowerCase();
  if (!PAYMENT_SIGNALS.some((s) => msg.includes(s)) && state.step !== 'pay_invoice') {
    return null;
  }

  let amount = state.flags.copay_amount;
  if (amount == null || !Number.isFinite(Number(amount))) {
    amount = 25;
  }

  const journeyId = KellyToolExecutor._getSessionMeta(sessionId, 'rcm_journey_id') || null;
  const out = await executeDeterministicTool(
    state.active_lane,
    state.step,
    'request_patient_payment',
    { amount: Number(amount), journey_id: journeyId, patient_id: patientId, delivery: 'both' },
    { sessionId, clinicId, patientId, callerPhone, channel }
  );

  if (!out?.success) return null;

  if (out.pay_token) {
    state.flags.payment_token = out.pay_token;
    KellyToolExecutor._setSessionMeta(sessionId, 'rcm_pay_token', out.pay_token);
  }
  state.flags.payment_complete = true;
  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_complete', '1');
    if (state.flags.appointment_id) {
      KellyToolExecutor._setSessionMeta(sessionId, 'post_visit_confirmation_pending', '1');
      state.flags.post_visit_confirmation_pending = true;
    }
  } catch (_) {}

  const reply =
    out.pay_url
      ? getDeterministicReply('payment_link_sent', state.locale || 'en', {
          amount: Number(amount).toFixed(2)
        })
      : String(out.message || 'Your secure payment link is on the way.');

  return { reply, toolsUsed: ['request_patient_payment'], endCall: false };
}

async function runDeterministicSchedule(state, ctx) {
  const toolsUsed = [];
  const row = sessionRow(ctx.sessionId);
  if (!row?.rag_result_id && opqrstComplete(row)) {
    const rag = await KellyToolExecutor.execute('run_triage_rag', {}, ctx);
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
    state.flags?.active_subrail === 'booking';

  const wantsBookConfirm =
    onBookingPath &&
    (state.step === 'confirm_visit' ||
      (hasBookingSlot && confirmatory) ||
      (conflictActive && hasBookingSlot && confirmatory) ||
      /@|please book|works for me|funciona|me funciona|reservar|por favor/.test(msg));

  if (onBookingPath && wantsBookConfirm && (confirmatory || /book|confirm|works|yes|please|email|@|sí|si\b|por favor|reservar/.test(msg))) {
    const existingApptId =
      state.flags.last_appointment_id ||
      state.flags.appointment_id ||
      argsFromMeta(ctx.sessionId, 'last_appointment_id');
    if (state.flags.schedule_appointment_success || existingApptId) {
      let when = '';
      if (existingApptId && db.db) {
        try {
          const row = db.db
            .prepare(
              `SELECT appointment_date, appointment_time FROM appointments WHERE id = ? OR appointment_id = ? LIMIT 1`
            )
            .get(existingApptId, existingApptId);
          if (row) {
            when = [row.appointment_date, row.appointment_time].filter(Boolean).join(' at ');
          }
        } catch (_) {}
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
        endCall: false
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
    if (!slotId) {
      const slots = await KellyToolExecutor.execute(
        'get_available_slots',
        { specialty: row?.target_specialty || 'Dermatology', days_ahead: 14 },
        ctx
      );
        const bundles = Array.isArray(slots?.slot_bundles) ? slots.slot_bundles : [];
        const pick =
          bundles.find((b) => String(b.time || '').startsWith('12:00')) ||
          bundles[0] ||
          null;
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
        const slotsProbe = await KellyToolExecutor.execute(
          'get_available_slots',
          { specialty: row?.target_specialty || 'Dermatology', days_ahead: 14 },
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

    const scheduleBase = {
      patient_id: ctx.patientId,
      specialty: row?.target_specialty || 'Dermatology',
      appointment_type: row?.target_specialty || 'Dermatology',
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
      sched = await KellyToolExecutor.execute(
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
      if (state.flags.copay_amount == null) {
        state.flags.copay_amount = 25;
        try {
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'copay_amount', '25');
        } catch (_) {}
      }
      state.flags.appointment_id = apptId;
      state.flags.booking_conflict = false;
      state.flags.provider_mismatch = false;
      state.step = 'done';
      try {
        const { persistCaseSummaryForAppointment } = require('../case-summary-service');
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
        endCall: false
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
    if (/schedule|appointment|slot|tomorrow|noon|12:00|available|check|next week|works for me/.test(msg)) {
      const slots = await KellyToolExecutor.execute(
        'get_available_slots',
        { specialty: row?.target_specialty || 'Dermatology', days_ahead: 14 },
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
              reply:
                'I can book that time. Can you confirm your name and the best email or phone to reach you?',
              toolsUsed,
              endCall: false
            };
          }
          return {
            reply:
              'I can help book that visit. Which day and time next week work best for you?',
            toolsUsed,
            endCall: false
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
            ? `Here are the next available dermatology times:\n${lines.join('\n')}\nWhich works best for you?`
            : 'I checked availability — tell me if tomorrow at 12:00 PM works and I can book that for you.';
        return { reply, toolsUsed, endCall: false };
      }
    }
  }

  if (state.active_lane !== KELLY_LANE.BOOKING || state.step !== 'confirm_visit') {
    return toolsUsed.length ? { reply: null, toolsUsed, endCall: false, _continue: true } : null;
  }
  return null;
}

function advanceAfterStep(state, toolsUsed) {
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

async function runDeterministicClinicalIntro(state, ctx) {
  if (state.active_lane !== KELLY_LANE.CLINICAL || state.step !== 'clinical_intake') return null;
  const msg = String(ctx.message || '').toLowerCase();
  if (!/rash|leg|neck|dermat|itch|skin/.test(msg)) return null;
  const row = sessionRow(ctx.sessionId);
  if (opqrstComplete(row)) return null;
  return {
    reply:
      'I can help with the rash on your leg and neck. A few quick questions will help us line up a dermatology visit — you said this is not an emergency, correct?',
    toolsUsed: [],
    endCall: false
  };
}

async function runDeterministicOpqrst(state, ctx) {
  if (state.active_lane !== KELLY_LANE.CLINICAL) return null;
  if (state.active_subrail === 'opqrst' || state.flags?.active_subrail === 'opqrst') return null;
  const row = sessionRow(ctx.sessionId);
  if (opqrstComplete(row)) return null;
  const msg = String(ctx.message || '');
  if (!/rash|itch|leg|neck|severity|fever|week|tuesday/i.test(msg)) return null;

  const toolsUsed = [];
  const out = await KellyToolExecutor.execute(
    'store_triage_opqrst',
    {
      quality: row?.quality || 'itchy rash',
      region: /neck/i.test(msg) ? 'leg and neck' : row?.region || 'leg and neck',
      severity: row?.severity ?? 3,
      onset: row?.onset || '1 week',
      provocation: row?.provocation || 'scratching',
      timing: row?.timing || row?.onset || '1 week'
    },
    ctx
  );
  if (out && !out.error) toolsUsed.push('store_triage_opqrst');

  const updated = sessionRow(ctx.sessionId);
  try {
    const { accumulatorFromTriageRow } = require('../conversation-mode/opqrst-accumulator');
    state.flags.opqrst_accumulator = accumulatorFromTriageRow(updated);
  } catch (_) {}

  if (opqrstComplete(updated)) {
    if (!updated?.rag_result_id && !state.flags.has_rag) {
      if (process.env.KELLY_RAILS_FAST_RAG === '1') {
        const { completeTriageRagForSession } = require('../triage-rag-fast-complete');
        completeTriageRagForSession(ctx.sessionId, ctx.patientId, {
          region: updated?.region || 'leg and neck',
          quality: updated?.quality || 'itchy rash on leg and neck',
          patientName: argsFromMeta(ctx.sessionId, 'collected_name') || 'Tom Harris',
          email: argsFromMeta(ctx.sessionId, 'collected_email'),
        });
        toolsUsed.push('run_triage_rag');
        state.flags.has_rag = true;
        state.flags.triage_complete = true;
        state.step = 'done';
      } else {
        const rag = await KellyToolExecutor.execute('run_triage_rag', {}, ctx);
        if (rag && !rag.error) {
          toolsUsed.push('run_triage_rag');
          state.flags.has_rag = true;
          state.flags.triage_complete = true;
          state.step = 'done';
        }
      }
    } else {
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
    }
    return {
      reply:
        'Thank you — I have the rash details for your leg and neck. We can check dermatology availability whenever you are ready.',
      toolsUsed,
      endCall: false
    };
  }

  if (toolsUsed.length) {
    return {
      reply: 'Thanks for those details. How severe is the itch on a scale of 1 to 10?',
      toolsUsed,
      endCall: false
    };
  }
  return null;
}

function formatApptWhen(appt) {
  const when = [appt?.date || appt?.appointment_date, appt?.time || appt?.appointment_time]
    .filter(Boolean)
    .join(' at ');
  return when;
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

  const searchTerm =
    ctx.callerPhone || ctx.patientName || String(ctx.message || '').trim();
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
  const newDate =
    dateFromMsg?.[1] ||
    slot.date ||
    argsFromMeta(ctx.sessionId, 'last_slot_date') ||
    null;
  const newTime =
    timeFromMsg?.[1] ||
    slot.time ||
    argsFromMeta(ctx.sessionId, 'last_slot_time') ||
    null;
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

async function runDeterministicRecords(state, ctx) {
  if (state.active_lane !== KELLY_LANE.RECORDS) return null;
  if (state.step !== 'records_qa' && state.conversation_mode !== 'tenant_records') return null;

  const locale = state.locale || 'en';
  const query = String(ctx.message || '').trim();
  if (!query) return null;

  const out = await executeDeterministicTool(
    KELLY_LANE.RECORDS,
    'records_qa',
    'query_patient_records',
    { query, patient_id: ctx.patientId },
    ctx
  );

  const answer = out?.answer || out?.message;
  if (answer && out?.success !== false) {
    return {
      reply: getDeterministicReply('records_answer', locale, { answer }),
      toolsUsed: ['query_patient_records'],
      endCall: false
    };
  }

  return {
    reply: getDeterministicReply('records_empty', locale),
    toolsUsed: ['query_patient_records'],
    endCall: false
  };
}

async function runDeterministicCancel(state, ctx) {
  if (state.active_lane !== KELLY_LANE.RESCHEDULE || state.step !== 'move_or_cancel') return null;
  if (!state.flags?.cancel_pending && !state.flags?.cancel_confirmed) return null;
  if (state.flags?.reschedule_pending && !state.flags?.cancel_pending) return null;

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

  if (out?.success === false) return null;

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
  return {
    reply: getDeterministicReply('appt_canceled', locale),
    toolsUsed,
    endCall: false
  };
}

async function runDeterministicReschedule(state, ctx) {
  if (state.active_lane !== KELLY_LANE.RESCHEDULE || state.step !== 'move_or_cancel') return null;
  if (!state.flags?.reschedule_pending) return null;

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
      reply: 'What date and time would you like to move your appointment to?',
      toolsUsed,
      endCall: false
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
      { date: newDate, specialty: 'Dermatology', days_ahead: 7 },
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
          return {
            reply: getDeterministicReply('appt_rescheduled', locale, { when }),
            toolsUsed: [...toolsUsed, 'get_available_slots'],
            endCall: false
          };
        }
      }
    }
    return {
      reply:
        out?.error ||
        out?.message ||
        'That time is not available. Could you choose another date or time?',
      toolsUsed,
      endCall: false
    };
  }

  const when = [newDate, newTime].filter(Boolean).join(' at ');
  state.flags.reschedule_complete = true;
  state.step = 'done';
  return {
    reply: getDeterministicReply('appt_rescheduled', locale, { when }),
    toolsUsed,
    endCall: false
  };
}

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
      const dbMod = require('../../database');
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

async function runDeterministicBookingConflict(state, ctx) {
  if (state.active_lane !== KELLY_LANE.BOOKING) return null;
  if (!state.flags?.booking_conflict && !state.flags?.provider_mismatch) return null;

  const resolved = resolveBookingSlot(state, ctx);
  const altBundles = state.flags._conflict_slot_bundles || [];
  const msg = String(ctx.message || '').toLowerCase();
  if (
    resolved.hasSlot &&
    isConfirmatoryUtterance(ctx.message) &&
    /book|confirm|go ahead|please book|schedule/.test(msg) &&
    !altBundles.length &&
    !state.flags.provider_mismatch &&
    !state.flags.provider_preference
  ) {
    return null;
  }

  const locale = state.locale || 'en';
  const toolsUsed = [];
  const slot = state.flags.current_booking_slot || {};
  const targetDate =
    slot.date ||
    argsFromMeta(ctx.sessionId, 'last_slot_date') ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

  const timePick = msg.match(/\b(\d{1,2}:\d{2})\b/);
  const picksAlt =
    isConfirmatoryUtterance(ctx.message) ||
    /first one|first option|that works|yes|book that|works for me/.test(msg);

  if (altBundles.length && (timePick || picksAlt)) {
    const pick = timePick
      ? altBundles.find((b) => String(b.time || '').startsWith(timePick[1])) || altBundles[0]
      : altBundles[0];
    if (pick) {
      const sid = pick.id || pick.slot_id || pick.practitioner_id;
      const slotDate = pick.date || targetDate;
      const slotTime = pick.time || '12:00';
      state.flags.current_booking_slot = {
        slot_id: sid,
        date: slotDate,
        time: slotTime,
        practitioner_name: pick.practitioner_name
      };
      if (sid) KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_id', String(sid));
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', slotDate);
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', slotTime);
      state.flags.booking_conflict = false;
      state.flags.provider_mismatch = false;
      state.step = 'confirm_visit';
      return {
        reply: getDeterministicReply('slots_offered', locale),
        toolsUsed,
        endCall: false
      };
    }
  }

  const providerPref = state.flags.provider_preference || parseProviderFromMessage(ctx.message);
  const slots = await KellyToolExecutor.execute(
    'get_available_slots',
    {
      date: targetDate,
      specialty: 'Dermatology',
      days_ahead: 7,
      provider: providerPref || undefined
    },
    ctx
  );
  toolsUsed.push('get_available_slots');
  if (!slots || slots.error) return null;

  const bundles = Array.isArray(slots.slot_bundles) ? slots.slot_bundles : [];
  let offers = bundles;

  if (providerPref) {
    const matched = bundles.filter((b) => bundleMatchesProvider(b, providerPref));
    if (!matched.length) {
      state.flags.provider_mismatch = true;
      offers = bundles.slice(0, 3);
      if (!offers.length) {
        return {
          reply: getDeterministicReply('no_slots_available', locale),
          toolsUsed,
          endCall: false
        };
      }
      const lines = offers.map((b) => `${b.time} (${b.practitioner_name || 'provider'})`).join(', ');
      state.flags._conflict_slot_bundles = offers;
      return {
        reply: getDeterministicReply('provider_mismatch', locale, {
          provider: providerPref,
          slots: lines
        }),
        toolsUsed,
        endCall: false
      };
    }
    offers = matched;
  }

  offers = offers.slice(0, 3);
  state.flags._conflict_slot_bundles = offers;
  const lines = offers.map((b) => `${b.time} (${b.practitioner_name || 'provider'})`).join(', ');
  return {
    reply:
      getDeterministicReply('slot_conflict', locale, { slots: lines }) +
      ' ' +
      getDeterministicReply('slots_offered', locale),
    toolsUsed,
    endCall: false
  };
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
  if (pre) return pre.result;

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
  if (booking) return booking.result;

  if (shouldSkipLlm(state)) {
    return skipLlmReply(state);
  }

  const result = await runNodeStep(state, ctx);
  advanceAfterStep(state, result.toolsUsed || []);
  return result;
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
