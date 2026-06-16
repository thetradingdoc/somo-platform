#!/usr/bin/env node
'use strict';

/**
 * Rails Conversation Sandbox — multi-turn Kelly + conversation-mode eval.
 *
 * Runs scripted patient dialogs against runKellyTurn (production path) and scores
 * whether each rail can complete a realistic conversation.
 *
 * Usage:
 *   node scripts/rails-conversation-sandbox.cjs
 *   node scripts/rails-conversation-sandbox.cjs --scenario booking
 *   node scripts/rails-conversation-sandbox.cjs --json
 *
 * Env (set automatically unless overridden):
 *   KELLY_RAILS_V2=1  CONVERSATION_MODE_ROUTING=enforce  KELLY_RAILS_ROLLOUT_PCT=1
 *   DB_PATH=./middleware-dev.db
 *
 * LLM: ANTHROPIC_API_KEY | GROQ_API_KEY | OPENAI_API_KEY for Kelly tool turns.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MP = path.join(__dirname, '..');
process.chdir(MP);

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.KELLY_ALLOW_HYBRID_GRAPH = process.env.KELLY_ALLOW_HYBRID_GRAPH || '0';
process.env.LANGGRAPH_KELLY_ROLLOUT_PCT = process.env.LANGGRAPH_KELLY_ROLLOUT_PCT || '0';
process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
process.env.KELLY_RAILS_ES_ENABLED = process.env.KELLY_RAILS_ES_ENABLED || '1';
process.env.KELLY_E2E_SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE || '1';
process.env.RCM_E2E_DIRECT_TOOLS = process.env.RCM_E2E_DIRECT_TOOLS || '1';
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');

const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');
const { runKellyTurn } = require('../services/kelly-turn-resolver');
const { seedModeAtCallStart } = require('../services/conversation-mode/conversation-mode-session');
const { resolveDispositionFromState } = require('../services/conversation-mode/disposition-taxonomy');

const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';
const ONLY = (() => {
  const i = process.argv.indexOf('--scenario');
  return i > -1 ? process.argv[i + 1] : null;
})();
const JSON_OUT = process.argv.includes('--json');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  grey: '\x1b[90m'
};
const bold = (s) => `${C.bold}${s}${C.reset}`;
const green = (s) => `${C.green}${s}${C.reset}`;
const red = (s) => `${C.red}${s}${C.reset}`;
const yellow = (s) => `${C.yellow}${s}${C.reset}`;
const cyan = (s) => `${C.cyan}${s}${C.reset}`;
const grey = (s) => `${C.grey}${s}${C.reset}`;

function hasLlmKey() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

function toolsInclude(toolsUsed, pattern) {
  return (Array.isArray(toolsUsed) ? toolsUsed : []).some((n) => pattern.test(String(n || '')));
}

function sandboxPhone() {
  return `+1555${String(1000000 + crypto.randomInt(0, 8999999))}`;
}

function uniqueTomorrowSlot(offsetHours = 0) {
  const base = fixtures.tomorrowAtNoonLocal?.() || {
    dateStr: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: '12:00',
    startDatetime: new Date(Date.now() + 86400000).toISOString(),
    endDatetime: new Date(Date.now() + 86400000 + 1800000).toISOString()
  };
  if (!offsetHours) return base;
  const start = new Date(base.startDatetime);
  start.setHours(start.getHours() + offsetHours);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    dateStr: start.toISOString().slice(0, 10),
    time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    startDatetime: start.toISOString(),
    endDatetime: end.toISOString()
  };
}

async function seedUniqueAppointment(sessionId, patientId, clinicId, opts = {}) {
  const offset = opts.slotOffsetHours ?? crypto.randomInt(1, 12);
  const noon = uniqueTomorrowSlot(offset);
  const apptId = opts.appointmentId || `appt_sandbox_${crypto.randomBytes(6).toString('hex')}`;
  try {
    return await fixtures.seedTomHarrisAppointment(sessionId, patientId, clinicId, {
      ...opts,
      appointmentId: apptId,
      noon
    });
  } catch (e) {
    if (!String(e.message || '').includes('UNIQUE')) throw e;
    return seedUniqueAppointment(sessionId, patientId, clinicId, {
      ...opts,
      slotOffsetHours: offset + crypto.randomInt(1, 6)
    });
  }
}

function ensurePatient(opts = {}) {
  const { dbModule } = fixtures.loadDb();
  const phone = opts.phone || sandboxPhone();
  let patient = dbModule.getFHIRPatientByPhone?.(phone);
  if (!patient) {
    const resourceId = `Patient/sandbox-${crypto.randomBytes(4).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: [opts.given || 'Sandbox'], family: opts.family || 'Patient' }],
      telecom: [
        { system: 'phone', value: phone },
        { system: 'email', value: opts.email || `sandbox-${crypto.randomBytes(4).toString('hex')}@somo.test` }
      ]
    });
    patient = dbModule.getFHIRPatient(resourceId);
  }
  const name = opts.name || `${opts.given || 'Sandbox'} ${opts.family || 'Patient'}`;
  return {
    patientId: patient.resource_id,
    patientName: name,
    patientPhone: phone,
    patientEmail: opts.email || patient.telecom?.find((t) => t.system === 'email')?.value || 'sandbox@somo.test'
  };
}

async function turn(ctx, userMsg, extra = {}) {
  const t0 = Date.now();
  const out = await runKellyTurn({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
    patientName: ctx.patientName,
    callerPhone: ctx.patientPhone,
    channel: 'voice',
    message: userMsg,
    call_type: ctx.call_type,
    direction: ctx.direction,
    opener_delivered: !!ctx.opener_delivered,
    preferredLanguage: extra.preferredLanguage || ctx.preferredLanguage,
    customerId: ctx.customerId || null,
    callId: ctx.sessionId,
    appointmentId: ctx.appointmentId || null,
    appointment_id: ctx.appointmentId || null,
    outbound_purpose: ctx.outbound_purpose || null
  });
  const latencyMs = Date.now() - t0;
  const transcript = {
    role: 'user',
    content: userMsg,
    reply: out?.reply || '',
    toolsUsed: out?.toolsUsed || [],
    conversation_mode: out?.conversation_mode,
    active_subrail: out?.active_subrail,
    lane: out?.kelly_rails?.active_lane,
    step: out?.kelly_rails?.step,
    language: out?.language,
    endCall: !!out?.endCall,
    latencyMs
  };
  ctx.transcript.push(transcript);
  ctx.allTools.push(...(out?.toolsUsed || []));
  if (out?.conversation_mode) ctx.finalMode = out.conversation_mode;
  if (out?.active_subrail) ctx.finalSubrail = out.active_subrail;
  if (out?.kelly_rails?.active_lane) ctx.finalLane = out.kelly_rails.active_lane;
  if (out?.language) ctx.finalLanguage = out.language;
  return out;
}

function countAppointments(patientId, sinceIso) {
  const { dbModule } = fixtures.loadDb();
  try {
    const row = dbModule.db
      .prepare(
        `SELECT COUNT(*) AS n FROM appointments
         WHERE patient_id = ? AND datetime(created_at) >= datetime(?)`
      )
      .get(patientId, sinceIso);
    return row?.n || 0;
  } catch (_) {
    return 0;
  }
}

function latestAppointment(patientId) {
  const { dbModule } = fixtures.loadDb();
  try {
    return dbModule.db
      .prepare(`SELECT * FROM appointments WHERE patient_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`)
      .get(patientId);
  } catch (_) {
    return null;
  }
}

function kellyEvents(sessionId, type) {
  const { dbModule } = fixtures.loadDb();
  try {
    const rows = dbModule.listKellyCallEvents?.({ session_id: sessionId, limit: 50 }) || [];
    return type ? rows.filter((r) => r.event_type === type) : rows;
  } catch (_) {
    return [];
  }
}

function sessionFlags(sessionId) {
  const KellyToolExecutor = fixtures.getKellyToolExecutor();
  const keys = [
    'conversation_mode',
    'active_subrail',
    'payment_token',
    'payment_complete',
    'last_appointment_id',
    'kelly_orchestrator_phase'
  ];
  const out = {};
  for (const k of keys) {
    const v = KellyToolExecutor._getSessionMeta(sessionId, k);
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

function triageUrgency(sessionId) {
  const { dbModule } = fixtures.loadDb();
  const row = dbModule.getTriageSession?.(sessionId);
  return row?.urgency || null;
}

function scoreScenario(result) {
  const checks = result.checks || {};
  let score = 0;
  const breakdown = [];

  if (checks.mode_ok) {
    score += 1.5;
    breakdown.push('+1.5 mode resolved correctly');
  } else breakdown.push('+0 mode mismatch');

  if (checks.rail_progression) {
    score += 2;
    breakdown.push('+2 rail/subrail progressed');
  } else if (checks.partial_rail) {
    score += 1;
    breakdown.push('+1 partial rail progression');
  } else breakdown.push('+0 rail stuck');

  if (checks.all_replies) {
    score += 1.5;
    breakdown.push('+1.5 Kelly replied every turn');
  } else if (checks.most_replies) {
    score += 0.75;
    breakdown.push('+0.75 most turns got replies');
  } else breakdown.push('+0 empty replies');

  if (checks.tools_ok) {
    score += 2;
    breakdown.push('+2 expected tools/subrail actions');
  } else if (checks.tools_partial) {
    score += 1;
    breakdown.push('+1 some expected tools');
  } else breakdown.push('+0 missing tools');

  if (checks.side_effect) {
    score += 2;
    breakdown.push('+2 side effect verified (booking/payment/urgent)');
  } else if (checks.side_effect_partial) {
    score += 1;
    breakdown.push('+1 partial side effect');
  } else breakdown.push('+0 no DB/outcome');

  if (checks.conversation_complete) {
    score += 1;
    breakdown.push('+1 conversation reached closure');
  } else breakdown.push('+0 no closure');

  return { score: Math.min(10, Math.round(score * 10) / 10), breakdown };
}

function analyzeReplies(ctx) {
  const replies = ctx.transcript.map((t) => t.reply).filter(Boolean);
  const all = ctx.transcript.length > 0 && replies.length === ctx.transcript.length;
  const most = replies.length >= Math.ceil(ctx.transcript.length * 0.7);
  return { all, most, empty: ctx.transcript.length - replies.length };
}

function uniqueModes(ctx) {
  return [...new Set(ctx.transcript.map((t) => t.conversation_mode).filter(Boolean))];
}

function uniqueSubrails(ctx) {
  return [...new Set(ctx.transcript.map((t) => t.active_subrail).filter(Boolean))];
}

// ─── Scenario runners ───────────────────────────────────────────────────────

async function scenarioBooking() {
  const id = 'booking';
  const patient = ensurePatient({ given: 'Book', family: 'Test', email: 'book-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_book');
  const since = new Date().toISOString();
  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    transcript: [],
    allTools: [],
    ...patient
  };

  fixtures.seedBookingReady(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    patientEmail: patient.patientEmail,
    patientPhone: patient.patientPhone,
    targetSpecialty: 'Dermatology'
  });
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to book a dermatology appointment',
    tenantResolved: true
  });

  const dialog = [
    'Hi, I need to book a dermatology appointment for an itchy rash.',
    '12:00 with Dr. Maria Santos works for me.',
    'Yes please book that slot.',
    `My name is ${patient.patientName}, email ${patient.patientEmail}, phone ${patient.patientPhone}.`
  ];

  for (const msg of dialog) {
    await turn(ctx, msg);
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }

  const apptBefore = countAppointments(patient.patientId, since);
  const { all, most } = analyzeReplies(ctx);
  const booked =
    toolsInclude(ctx.allTools, /schedule_appointment/i) ||
    apptBefore > 0 ||
    !!latestAppointment(patient.patientId);
  const slotsCalled = toolsInclude(ctx.allTools, /get_available_slots/i);
  const modes = uniqueModes(ctx);
  const subrails = uniqueSubrails(ctx);

  const checks = {
    mode_ok: modes.includes('tenant_inbound_admin') || modes.includes('tenant_inbound_clinical') || ctx.finalLane === 'booking',
    rail_progression: subrails.includes('booking') || ctx.finalLane === 'booking' || slotsCalled,
    partial_rail: slotsCalled || ctx.finalLane === 'booking',
    all_replies: all,
    most_replies: most,
    tools_ok: slotsCalled && booked,
    tools_partial: slotsCalled || booked,
    side_effect: booked,
    side_effect_partial: slotsCalled,
    conversation_complete: booked || toolsInclude(ctx.allTools, /schedule_appointment/i)
  };

  return {
    id,
    title: '1. Book an appointment (English)',
    ctx,
    checks,
    evidence: {
      modes,
      subrails,
      finalLane: ctx.finalLane,
      tools: [...new Set(ctx.allTools)],
      appointment: latestAppointment(patient.patientId),
      sessionFlags: sessionFlags(sessionId)
    },
    gaps: [
      !booked && 'Appointment not created in DB — schedule_appointment may not have fired',
      !slotsCalled && 'get_available_slots never called',
      !checks.mode_ok && 'Mode did not land on admin/clinical booking path'
    ].filter(Boolean)
  };
}

async function scenarioPayment() {
  const id = 'payment';
  const patient = ensurePatient({ given: 'Pay', family: 'Test', email: 'pay-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_pay');
  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    transcript: [],
    allTools: [],
    ...patient
  };

  fixtures.seedPayReady(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    patientEmail: patient.patientEmail,
    patientPhone: patient.patientPhone,
    copayAmount: 25
  });
  await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone
  });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to pay my copay',
    tenantResolved: true
  });

  const dialog = [
    'I need to pay my copay for my upcoming visit.',
    `Yes, my name is ${patient.patientName} and date of birth is January 15 1990.`,
    'Yes, please send the secure payment link to my phone.',
    'Got it, I will pay on the link. Thanks.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const flags = sessionFlags(sessionId);
  const payTool = toolsInclude(ctx.allTools, /request_patient_payment|create_payment|pay_invoice/i);
  const billingMode = uniqueModes(ctx).includes('tenant_billing');
  const copaySubrail = uniqueSubrails(ctx).includes('copay_link');
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: billingMode || ctx.finalLane === 'payment' || payTool,
    rail_progression: copaySubrail || ctx.finalLane === 'payment',
    partial_rail: payTool,
    all_replies: all,
    most_replies: most,
    tools_ok: payTool,
    tools_partial: payTool || flags.payment_token,
    side_effect: payTool || !!flags.payment_token || !!flags.payment_complete,
    side_effect_partial: billingMode,
    conversation_complete: payTool || flags.payment_token
  };

  return {
    id,
    title: '2. Copay payment (English)',
    ctx,
    checks,
    evidence: {
      modes: uniqueModes(ctx),
      subrails: uniqueSubrails(ctx),
      tools: [...new Set(ctx.allTools)],
      sessionFlags: flags
    },
    gaps: [
      !billingMode && 'Billing rail not selected at call start (mid-call pivot gap)',
      !payTool && 'request_patient_payment not invoked',
      !flags.payment_token && 'No payment_token in session meta'
    ].filter(Boolean)
  };
}

async function scenarioCallingAboutAppt() {
  const id = 'calling_about_appt';
  const patient = ensurePatient({ given: 'Appt', family: 'Caller', email: 'appt-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_appt');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone,
    slotOffsetHours: 3
  });

  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    transcript: [],
    allTools: [],
    appointmentId: apptId,
    ...patient
  };

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I am calling about my appointment',
    tenantResolved: true
  });

  const dialog = [
    'Hi, I am calling about my upcoming dermatology appointment.',
    `My name is ${patient.patientName}. Can you confirm the date and time?`,
    'Great, I will keep that time. Nothing else, thanks.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const searchTool = toolsInclude(ctx.allTools, /search_appointments|get_triage_session/i);
  const cancelSubrail = uniqueSubrails(ctx).includes('cancellation');
  const repliesMentionTime = ctx.transcript.some((t) => /noon|12|tomorrow|appointment|dermatology/i.test(t.reply));
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: uniqueModes(ctx).includes('tenant_inbound_admin') || ctx.finalLane,
    rail_progression: searchTool || cancelSubrail,
    partial_rail: repliesMentionTime,
    all_replies: all,
    most_replies: most,
    tools_ok: searchTool && repliesMentionTime,
    tools_partial: searchTool,
    side_effect: searchTool && repliesMentionTime,
    side_effect_partial: searchTool || repliesMentionTime,
    conversation_complete: repliesMentionTime && searchTool
  };

  return {
    id,
    title: '3. Calling about existing appointment',
    ctx,
    checks,
    evidence: {
      appointmentId: apptId,
      appointment: latestAppointment(patient.patientId),
      tools: [...new Set(ctx.allTools)],
      modes: uniqueModes(ctx)
    },
    gaps: [
      !searchTool && 'search_appointments not used — may rely on LLM memory only',
      !repliesMentionTime && 'Kelly did not confirm appointment details in reply'
    ].filter(Boolean)
  };
}

async function scenarioOutboundReminder() {
  const id = 'outbound_reminder';
  const patient = ensurePatient({ given: 'Remind', family: 'Patient', email: 'remind-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_out');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone,
    slotOffsetHours: 5
  });

  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'operator_outbound',
    direction: 'outbound',
    opener_delivered: true,
    transcript: [],
    allTools: [],
    appointmentId: apptId,
    outbound_purpose: 'appointment_reminder',
    ...patient
  };

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'operator_outbound',
    direction: 'outbound',
    tenantResolved: true,
    appointmentId: apptId,
    outbound_purpose: 'appointment_reminder'
  });

  const dialog = [
    'Yes, I have a moment.',
    'Thanks for the reminder about my dermatology appointment tomorrow.',
    'No, I am all set. Goodbye.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const operatorMode = uniqueModes(ctx).includes('operator_outbound');
  const ended = ctx.transcript.some((t) => t.endCall);
  const mentionsReminder = ctx.transcript.some((t) =>
    /appointment|reminder|tomorrow|dermatology|visit/i.test(t.reply)
  );
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: operatorMode,
    rail_progression: operatorMode && ctx.transcript.length >= 2,
    partial_rail: operatorMode,
    all_replies: all,
    most_replies: most,
    tools_ok: false,
    tools_partial: false,
    side_effect: ended || mentionsReminder,
    side_effect_partial: operatorMode,
    conversation_complete: ended || ctx.transcript[ctx.transcript.length - 1]?.reply
  };

  return {
    id,
    title: '4. Outbound appointment reminder call',
    ctx,
    checks,
    evidence: {
      modes: uniqueModes(ctx),
      tools: [...new Set(ctx.allTools)],
      appointmentId: apptId,
      endCall: ended
    },
    gaps: [
      'No dedicated appointment-reminder outbound rail — uses operator_outbound stub',
      !mentionsReminder && 'Opener does not reference seeded appointment context',
      !ended && 'Call did not reach endCall on goodbye'
    ].filter(Boolean)
  };
}

async function scenarioUrgentInquiry() {
  const id = 'urgent_inquiry';
  const patient = ensurePatient({ given: 'Urgent', family: 'Case', email: 'urgent-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_urgent');
  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    transcript: [],
    allTools: [],
    ...patient
  };

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I have severe chest pain',
    tenantResolved: true
  });

  const dialog = [
    'I have severe chest pain spreading to my left arm, it started 20 minutes ago.',
    'The pain is 9 out of 10, crushing pressure, worse with exertion.',
    'It radiates to my jaw and I feel short of breath.',
    'No, this has never happened before. I need help right away.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const clinicalMode = uniqueModes(ctx).includes('tenant_inbound_clinical');
  const opqrst = uniqueSubrails(ctx).includes('opqrst');
  const emergency = uniqueModes(ctx).includes('emergency_safety');
  const urgentReply = ctx.transcript.some((t) =>
    /urgent|emergency|911|immediately|escalat|handoff|nurse/i.test(t.reply)
  );
  const flags = sessionFlags(sessionId);
  const disposition = resolveDispositionFromState({
    conversation_mode: ctx.finalMode,
    active_subrail: ctx.finalSubrail,
    flags: { ...flags, safety_blocked: emergency || urgentReply }
  });
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: clinicalMode || emergency,
    rail_progression: opqrst || emergency,
    partial_rail: clinicalMode,
    all_replies: all,
    most_replies: most,
    tools_ok: urgentReply && (opqrst || emergency),
    tools_partial: urgentReply || opqrst,
    side_effect: urgentReply || emergency || disposition === 'emergency_redirect' || disposition === 'escalated',
    side_effect_partial: clinicalMode,
    conversation_complete: urgentReply || emergency
  };

  return {
    id,
    title: '5. Urgent inquiry (dashboard escalation)',
    ctx,
    checks,
    evidence: {
      modes: uniqueModes(ctx),
      subrails: uniqueSubrails(ctx),
      disposition,
      triageUrgency: triageUrgency(sessionId),
      tools: [...new Set(ctx.allTools)],
      sessionFlags: flags
    },
    gaps: [
      !urgentReply && 'No urgent/emergency language in Kelly replies',
      !opqrst && 'OPQRST subrail not entered for symptom call',
      'OPQRST exit fork to book/escalate may be incomplete after last question'
    ].filter(Boolean)
  };
}

async function scenarioSpanishBooking() {
  const id = 'spanish_booking';
  const patient = ensurePatient({ given: 'Cita', family: 'Español', email: 'es-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_es');
  const since = new Date().toISOString();
  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    preferredLanguage: 'es',
    transcript: [],
    allTools: [],
    ...patient
  };

  fixtures.seedBookingReady(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    patientEmail: patient.patientEmail,
    patientPhone: patient.patientPhone,
    language: 'es',
    targetSpecialty: 'Dermatology'
  });
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'Hola, quiero reservar una cita de dermatología',
    tenantResolved: true
  });

  const dialog = [
    'Hola, quiero reservar una cita de dermatología para un sarpullido.',
    'Las 12:00 con la Dra. Maria Santos me funciona.',
    'Sí, por favor reserve ese horario.',
    `Me llamo ${patient.patientName}, correo ${patient.patientEmail}, teléfono ${patient.patientPhone}.`
  ];

  for (const msg of dialog) {
    await turn(ctx, msg, { preferredLanguage: 'es' });
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }

  const spanishDetected = ctx.transcript.some((t) => t.language === 'es') || ctx.finalLanguage === 'es';
  const booked =
    toolsInclude(ctx.allTools, /schedule_appointment/i) || countAppointments(patient.patientId, since) > 0;
  const slotsCalled = toolsInclude(ctx.allTools, /get_available_slots/i);
  const spanishReply = ctx.transcript.some((t) =>
    /cita|horario|dermatolog|reserv|gracias|puedo/i.test(t.reply)
  );
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: spanishDetected,
    rail_progression: slotsCalled || ctx.finalLane === 'booking',
    partial_rail: spanishDetected,
    all_replies: all,
    most_replies: most,
    tools_ok: slotsCalled && booked && spanishDetected,
    tools_partial: slotsCalled || spanishReply,
    side_effect: booked,
    side_effect_partial: slotsCalled,
    conversation_complete: booked || slotsCalled
  };

  return {
    id,
    title: '6. Spanish appointment booking',
    ctx,
    checks,
    evidence: {
      language: ctx.finalLanguage,
      tools: [...new Set(ctx.allTools)],
      appointment: latestAppointment(patient.patientId),
      spanishReply
    },
    gaps: [
      !spanishDetected && 'Spanish locale not detected/persisted',
      !spanishReply && 'Replies may still be English',
      !booked && 'Appointment not booked in Spanish flow'
    ].filter(Boolean)
  };
}

async function scenarioMandarinPayment() {
  const id = 'mandarin_payment';
  const patient = ensurePatient({ given: '付款', family: 'Test', email: 'zh-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_zh');
  const ctx = {
    id,
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    preferredLanguage: 'zh',
    transcript: [],
    allTools: [],
    ...patient
  };

  fixtures.seedPayReady(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    patientEmail: patient.patientEmail,
    patientPhone: patient.patientPhone,
    language: 'zh',
    copayAmount: 30
  });
  await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone
  });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: '我想付 copay',
    tenantResolved: true
  });

  const dialog = [
    '你好，我想付我的 copay 诊费。',
    '是的，我叫' + patient.patientName + '，生日是1990年1月15日。',
    '请发短信付款链接到我的手机。',
    '好的，谢谢。'
  ];

  for (const msg of dialog) await turn(ctx, msg, { preferredLanguage: 'zh' });

  const zhDetected = ctx.transcript.some((t) => t.language === 'zh') || ctx.finalLanguage === 'zh';
  const handoff = ctx.transcript.some((t) => /转接|specialist|人工|handoff|connecting you/i.test(t.reply));
  const payTool = toolsInclude(ctx.allTools, /request_patient_payment/i);
  const billingMode = uniqueModes(ctx).includes('tenant_billing');
  const mandarinReply = ctx.transcript.some((t) => /付款|链接|copay|支付|谢谢/.test(t.reply));
  const flags = sessionFlags(sessionId);
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: zhDetected || billingMode,
    rail_progression: billingMode || payTool,
    partial_rail: zhDetected,
    all_replies: all,
    most_replies: most,
    tools_ok: payTool && zhDetected && !handoff,
    tools_partial: payTool || mandarinReply,
    side_effect: payTool || flags.payment_token,
    side_effect_partial: billingMode || handoff,
    conversation_complete: payTool || handoff
  };

  return {
    id,
    title: '7. Mandarin copay payment',
    ctx,
    checks,
    evidence: {
      language: ctx.finalLanguage,
      modes: uniqueModes(ctx),
      tools: [...new Set(ctx.allTools)],
      handoff,
      sessionFlags: flags
    },
    gaps: [
      handoff && 'Mandarin may trigger language handoff instead of completing copay flow',
      !mandarinReply && 'Replies not in Mandarin',
      !payTool && 'Payment link tool not invoked for zh locale'
    ].filter(Boolean)
  };
}

const SCENARIOS = [
  scenarioBooking,
  scenarioPayment,
  scenarioCallingAboutAppt,
  scenarioOutboundReminder,
  scenarioUrgentInquiry,
  scenarioSpanishBooking,
  scenarioMandarinPayment
];

function printTranscript(ctx) {
  console.log(grey('  ── transcript ──'));
  ctx.transcript.forEach((t, i) => {
    console.log(`  ${cyan(`T${i + 1}`)} patient: ${t.content}`);
    console.log(`     kelly:  ${(t.reply || red('[empty]')).slice(0, 220)}${t.reply?.length > 220 ? '…' : ''}`);
    if (t.toolsUsed?.length) console.log(grey(`     tools: ${t.toolsUsed.join(', ')}`));
    if (t.conversation_mode) console.log(grey(`     mode=${t.conversation_mode} subrail=${t.active_subrail || '-'} lane=${t.lane || '-'}`));
  });
}

function scoreColor(n) {
  if (n >= 8) return green(String(n));
  if (n >= 5) return yellow(String(n));
  return red(String(n));
}

async function main() {
  const llm = hasLlmKey();
  const dbPath = process.env.DB_PATH;

  if (!fs.existsSync(dbPath)) {
    console.error(red(`DB not found: ${dbPath}`));
    console.error('Run: ALLOW_DEMO_SEED=1 npm run seed:demo');
    process.exit(1);
  }

  console.log(bold('\n═ Kelly Rails Conversation Sandbox ═\n'));
  console.log(`DB: ${dbPath}`);
  console.log(`LLM: ${llm ? green('available') : yellow('NOT SET — Kelly tool turns may return empty/stub replies')}`);
  console.log(`Routing: ${process.env.CONVERSATION_MODE_ROUTING}\n`);

  const results = [];
  const selected = ONLY ? SCENARIOS.filter((fn) => fn.name.replace('scenario', '').toLowerCase() === ONLY || fn.name.includes(ONLY)) : SCENARIOS;

  if (ONLY && selected.length === 0) {
    console.error(red(`Unknown scenario: ${ONLY}`));
    process.exit(1);
  }

  for (const run of selected) {
    const result = await run();
    const { score, breakdown } = scoreScenario(result);
    result.score = score;
    result.breakdown = breakdown;
    results.push(result);

    console.log(bold(`\n${result.title}`));
    console.log(`Score: ${scoreColor(score)}/10`);
    printTranscript(result.ctx);
    if (result.gaps?.length) {
      console.log(yellow('  Gaps:'));
      result.gaps.forEach((g) => console.log(yellow(`    • ${g}`)));
    }
    breakdown.forEach((b) => console.log(grey(`  ${b}`)));
    fixtures.teardownKellySession(result.ctx.sessionId);
  }

  const avg = results.length
    ? Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 10) / 10
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath,
    llmAvailable: llm,
    conversationModeRouting: process.env.CONVERSATION_MODE_ROUTING,
    averageScore: avg,
    scenarios: results.map((r) => ({
      id: r.id,
      title: r.title,
      score: r.score,
      breakdown: r.breakdown,
      gaps: r.gaps,
      evidence: r.evidence,
      transcript: r.ctx.transcript.map((t) => ({
        user: t.content,
        kelly: t.reply,
        tools: t.toolsUsed,
        mode: t.conversation_mode,
        subrail: t.active_subrail,
        lane: t.lane
      }))
    }))
  };

  const outDir = path.join(MP, 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, 'rails-conversation-sandbox.md');
  const jsonPath = path.join(outDir, 'rails-conversation-sandbox.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  let md = `# Kelly Rails Conversation Sandbox\n\n`;
  md += `Generated: ${report.generatedAt}\n\n`;
  md += `**Average confidence: ${avg}/10** · LLM: ${llm ? 'yes' : 'no'} · DB: \`${dbPath}\`\n\n`;
  md += `| # | Scenario | Score | Booking/Payment/Urgent |\n|---|----------|-------|------------------------|\n`;
  for (const r of results) {
    const outcome =
      r.id === 'booking' || r.id === 'spanish_booking'
        ? r.evidence.appointment ? '✓ appt in DB' : '✗ no appt'
        : r.id === 'payment' || r.id === 'mandarin_payment'
          ? r.checks.side_effect ? '✓ payment path' : '✗ no payment'
          : r.id === 'urgent_inquiry'
            ? r.checks.side_effect ? '✓ urgent signal' : '✗ not urgent'
            : r.id === 'outbound_reminder'
              ? r.checks.conversation_complete ? '✓ closed' : '○ partial'
              : r.checks.side_effect ? '✓ answered' : '○ partial';
    md += `| ${r.id} | ${r.title} | **${r.score}/10** | ${outcome} |\n`;
  }
  md += `\n## Per-scenario notes\n\n`;
  for (const r of results) {
    md += `### ${r.title} (${r.score}/10)\n\n`;
    if (r.gaps?.length) {
      md += `**Gaps:** ${r.gaps.join('; ')}\n\n`;
    }
    md += `**Evidence:** \`${JSON.stringify(r.evidence)}\`\n\n`;
  }
  fs.writeFileSync(mdPath, md);

  console.log(bold(`\n═ Summary: average ${scoreColor(avg)}/10 across ${results.length} scenarios ═`));
  console.log(`Report: ${mdPath}`);

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exit(avg < 4 ? 1 : 0);
}

main().catch((e) => {
  console.error(red(e.stack || e.message));
  process.exit(1);
});
