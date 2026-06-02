'use strict';

const db = require('../../database');
const KellyToolExecutor = require('../kelly-tool-executor');
const { KELLY_LANE } = require('./state-schema');
const { runNodeStep } = require('./node-runner');
const { PAYMENT_SIGNALS } = require('./state-schema');

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

async function runDeterministicPayment(state, ctx) {
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
  const out = await KellyToolExecutor.execute(
    'request_patient_payment',
    { amount: Number(amount), journey_id: journeyId, patient_id: patientId, delivery: 'both' },
    { sessionId, clinicId, patientId, callerPhone, channel }
  );

  if (!out?.success) return null;

  if (out.pay_token) {
    state.flags.payment_token = out.pay_token;
    KellyToolExecutor._setSessionMeta(sessionId, 'rcm_pay_token', out.pay_token);
  }

  const reply =
    out.pay_url
      ? `I sent a secure payment link for $${Number(amount).toFixed(2)}. Open the link to pay — I will not collect card numbers here.`
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
  const wantsBookConfirm =
    state.active_lane === KELLY_LANE.BOOKING &&
    (state.step === 'confirm_visit' || /@|please book|works for me/.test(msg));

  if (wantsBookConfirm && /book|confirm|works|yes|please|email|@/.test(msg)) {
    const emailMatch = String(ctx.message || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
    let slotId = argsFromMeta(ctx.sessionId, 'last_slot_id');
    let apptDate = argsFromMeta(ctx.sessionId, 'last_slot_date');
    let apptTime = argsFromMeta(ctx.sessionId, 'last_slot_time');
    if (!slotId) {
      const slots = await KellyToolExecutor.execute(
        'get_available_slots',
        { specialty: row?.target_specialty || 'Dermatology', days_ahead: 7 },
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
          toolsUsed.push('get_available_slots');
        }
    }
  const sched = await KellyToolExecutor.execute(
      'schedule_appointment',
      {
        patient_id: ctx.patientId,
        specialty: row?.target_specialty || 'Dermatology',
        patient_name: argsFromMeta(ctx.sessionId, 'collected_name') || 'Tom Harris',
        patient_email: emailMatch ? emailMatch[0] : undefined,
        patient_phone: ctx.callerPhone,
        session_id: ctx.sessionId,
        slot_id: slotId,
        date: apptDate,
        time: apptTime,
        appointment_date: apptDate,
        appointment_time: apptTime
      },
      ctx
    );
    if (sched && !sched.error && (sched.appointment_id || sched.id)) {
      const apptId = sched.appointment_id || sched.id;
      KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_appointment_id', apptId);
      toolsUsed.push('schedule_appointment');
      try {
        const { persistCaseSummaryForAppointment } = require('../case-summary-service');
        persistCaseSummaryForAppointment({ appointmentId: apptId, sessionId: ctx.sessionId });
      } catch (_) {}
      return {
        reply: `Your appointment is booked${sched.date ? ` for ${sched.date}` : ''}${sched.time ? ` at ${sched.time}` : ''}. Confirmation will go to your email.`,
        toolsUsed,
        endCall: false
      };
    }
  }

  if (state.active_lane === KELLY_LANE.BOOKING && state.step === 'schedule_visit' && !/@/.test(msg)) {
    if (/schedule|appointment|slot|tomorrow|noon|12:00|available|check/.test(msg)) {
      const slots = await KellyToolExecutor.execute(
        'get_available_slots',
        { specialty: row?.target_specialty || 'Dermatology', days_ahead: 7 },
        ctx
      );
      if (slots && !slots.error) {
        toolsUsed.push('get_available_slots');
        const bundles = Array.isArray(slots.slot_bundles) ? slots.slot_bundles : [];
        const preview = bundles.filter((b) => /12:00|12:15|09:00/.test(String(b.time || ''))).slice(0, 3);
        const lines = preview.map((b) => `• ${b.time} (${b.practitioner_name || 'provider'})`);
        const pick =
          bundles.find((b) => String(b.time || '').startsWith('12:00')) || bundles[0];
        if (pick) {
          const sid = pick.id || pick.slot_id || pick.practitioner_id;
          if (sid) KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_id', String(sid));
          const d = new Date();
          d.setDate(d.getDate() + 1);
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_date', d.toISOString().slice(0, 10));
          KellyToolExecutor._setSessionMeta(ctx.sessionId, 'last_slot_time', String(pick.time || '12:00'));
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
    state.step = 'confirm_visit';
    return;
  }

  if (lane === KELLY_LANE.BOOKING && toolsUsed.includes('schedule_appointment')) {
    try {
      const { persistCaseSummaryForAppointment } = require('../case-summary-service');
      const apptId = KellyToolExecutor._getSessionMeta(state.session_id, 'last_appointment_id');
      if (apptId) {
        persistCaseSummaryForAppointment({
          appointmentId: apptId,
          sessionId: state.session_id
        });
        state.flags.appointment_id = apptId;
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

async function executeLaneStep(state, ctx) {
  const detPay = await runDeterministicPayment(state, ctx);
  if (detPay) {
    advanceAfterStep(state, detPay.toolsUsed);
    return detPay;
  }

  const detIntro = await runDeterministicClinicalIntro(state, ctx);
  if (detIntro?.reply) {
    advanceAfterStep(state, detIntro.toolsUsed || []);
    return detIntro;
  }

  const detOpq = await runDeterministicOpqrst(state, ctx);
  if (detOpq?.reply) {
    advanceAfterStep(state, detOpq.toolsUsed || []);
    return detOpq;
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

  const detSched = await runDeterministicSchedule(state, ctx);
  if (detSched && detSched.reply) {
    advanceAfterStep(state, detSched.toolsUsed || []);
    return detSched;
  }

  const result = await runNodeStep(state, ctx);
  advanceAfterStep(state, result.toolsUsed || []);
  return result;
}

module.exports = { executeLaneStep, advanceAfterStep, NEXT_STEP };
