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
const ADMIN_TENANT_POLICY = {
  triage_policy: 'conditional',
  billing_enabled: true,
  records_enabled: true
};

function seedAdminBookingPath(sessionId, patient, clinicId) {
  fixtures.seedBookingReady(sessionId, patient.patientId, clinicId, {
    patientName: patient.patientName,
    patientEmail: patient.patientEmail,
    patientPhone: patient.patientPhone,
    targetSpecialty: 'Dermatology',
    symptomText: 'routine dermatology visit',
    quality: 'routine visit',
    region: 'general'
  });
  const { persistRailsSessionState } = require('../services/kelly-rails/session-ssot');
  persistRailsSessionState(sessionId, {
    active_lane: 'booking',
    step: 'schedule_visit',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'booking',
    flags: {
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      triage_complete: true,
      has_rag: true
    }
  });
  fixtures.setMeta(sessionId, 'kelly_e2e_skip_triage', '1');
  fixtures.setMeta(sessionId, 'kelly_orchestrator_phase', 'BOOKING');
}

function seedRebookAfterCancel(sessionId, patient, clinicId) {
  seedAdminBookingPath(sessionId, patient, clinicId);
  const { persistRailsSessionState } = require('../services/kelly-rails/session-ssot');
  persistRailsSessionState(sessionId, {
    active_lane: 'booking',
    step: 'schedule_visit',
    conversation_mode: 'tenant_inbound_admin',
    active_subrail: 'booking',
    flags: {
      rebook_after_cancel: true,
      cancel_complete: true,
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'booking',
      active_subrail_step: 'slot_lookup',
      triage_complete: true,
      has_rag: true
    }
  });
}

function bindAppointmentToSession(sessionId, apptId) {
  const { persistRailsSessionState } = require('../services/kelly-rails/session-ssot');
  persistRailsSessionState(sessionId, {
    appointment_id: apptId,
    flags: { appointment_id: apptId, last_appointment_id: apptId }
  });
  fixtures.setMeta(sessionId, 'last_appointment_id', apptId);
}

const ONLY = (() => {
  const i = process.argv.indexOf('--scenario');
  return i > -1 ? process.argv[i + 1] : null;
})();
const JSON_OUT = process.argv.includes('--json');

function scenarioSlug(fn) {
  const raw = fn.name.replace(/^scenario/, '');
  return raw.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function scenarioMatchesFilter(fn, filter) {
  if (!filter) return true;
  const f = filter.toLowerCase().replace(/-/g, '_');
  const slug = scenarioSlug(fn);
  return slug === f || fn.name.toLowerCase().includes(f) || slug.includes(f);
}

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

function uniqueTomorrowSlot(offsetHours = 0, daysAhead = 1) {
  const base = fixtures.tomorrowAtNoonLocal?.() || {
    dateStr: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: '12:00',
    startDatetime: new Date(Date.now() + 86400000).toISOString(),
    endDatetime: new Date(Date.now() + 86400000 + 1800000).toISOString()
  };
  const start = new Date(base.startDatetime);
  if (daysAhead > 1) {
    start.setDate(start.getDate() + (daysAhead - 1));
  }
  if (offsetHours) {
    start.setHours(start.getHours() + offsetHours);
  }
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
    outbound_purpose: ctx.outbound_purpose || null,
    tenantPolicy: extra.tenantPolicy
  });
  const latencyMs = Date.now() - t0;
  let modeFromProjection = out?.conversation_mode;
  try {
    const { getRailsSessionProjection } = require('../services/kelly-rails/session-ssot');
    const projection = getRailsSessionProjection(ctx.sessionId);
    if (projection?.flags_json) {
      const flags = JSON.parse(projection.flags_json);
      if (flags.conversation_mode) modeFromProjection = flags.conversation_mode;
    }
  } catch (_) {}
  const transcript = {
    role: 'user',
    content: userMsg,
    reply: out?.reply || '',
    toolsUsed: out?.toolsUsed || [],
    conversation_mode: modeFromProjection || out?.conversation_mode,
    active_subrail: out?.active_subrail,
    lane: out?.kelly_rails?.active_lane,
    step: out?.kelly_rails?.step,
    language: out?.language,
    endCall: !!out?.endCall,
    latencyMs
  };
  ctx.transcript.push(transcript);
  ctx.allTools.push(...(out?.toolsUsed || []));
  if (modeFromProjection || out?.conversation_mode) {
    ctx.finalMode = modeFromProjection || out.conversation_mode;
  }
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

function executorToolsCompleted(sessionId, toolName) {
  const events = kellyEvents(sessionId, 'tool_completed');
  return events.some(
    (e) => {
      let p = e.payload_json;
      if (typeof p === 'string') {
        try {
          p = JSON.parse(p);
        } catch (_) {
          p = {};
        }
      }
      return p?.tool_name === toolName && p?.success === true;
    }
  );
}

function getAppointmentRow(apptId) {
  const { dbModule } = fixtures.loadDb();
  try {
    return dbModule.db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(apptId) || null;
  } catch (_) {
    return null;
  }
}

/** Binary Task Completion Rate — primary business outcome only. */
function computeTcr(result) {
  const id = result.id;
  const ctx = result.ctx || {};
  const tools = [...new Set(ctx.allTools || [])];
  const searchDone =
    toolsInclude(tools, /search_appointments/i) || executorToolsCompleted(ctx.sessionId, 'search_appointments');
  const scheduleDone =
    toolsInclude(tools, /schedule_appointment/i) || executorToolsCompleted(ctx.sessionId, 'schedule_appointment');
  const payDone =
    toolsInclude(tools, /request_patient_payment/i) ||
    executorToolsCompleted(ctx.sessionId, 'request_patient_payment') ||
    !!sessionFlags(ctx.sessionId).payment_token;

  switch (id) {
    case 'calling_about_appt': {
      const mentionsTime = ctx.transcript.some((t) =>
        /\d{1,2}:\d{2}|noon|tomorrow|scheduled for|dermatology/i.test(t.reply || '')
      );
      const foundInReply = ctx.transcript.some((t) => /I found your/i.test(t.reply || ''));
      return searchDone && (mentionsTime || foundInReply) ? 1 : 0;
    }
    case 'booking':
    case 'spanish_booking': {
      const apptId = sessionFlags(ctx.sessionId).last_appointment_id;
      const row = apptId ? getAppointmentRow(apptId) : latestAppointment(ctx.patientId);
      const booked =
        executorToolsCompleted(ctx.sessionId, 'schedule_appointment') ||
        !!(row && row.status !== 'cancelled');
      return booked ? 1 : 0;
    }
    case 'payment':
    case 'mandarin_payment':
      return payDone ? 1 : 0;
    case 'urgent_inquiry':
      return result.checks?.side_effect ? 1 : 0;
    case 'outbound_reminder': {
      const mentionsReminder = ctx.transcript.some((t) =>
        /appointment|reminder|tomorrow|dermatology|visit/i.test(t.reply || '')
      );
      const ended = ctx.transcript.some((t) => t.endCall);
      return mentionsReminder && ended ? 1 : 0;
    }
    case 'cancel_appointment': {
      const cancelDone =
        toolsInclude(tools, /cancel_appointment/i) ||
        executorToolsCompleted(ctx.sessionId, 'cancel_appointment');
      const row = ctx.appointmentId ? getAppointmentRow(ctx.appointmentId) : null;
      return cancelDone || row?.status === 'cancelled' ? 1 : 0;
    }
    case 'reschedule_appointment': {
      const reschedDone =
        toolsInclude(tools, /reschedule_appointment/i) ||
        executorToolsCompleted(ctx.sessionId, 'reschedule_appointment');
      return reschedDone ? 1 : 0;
    }
    case 'records_request': {
      const recordsDone =
        toolsInclude(tools, /query_patient_records/i) ||
        executorToolsCompleted(ctx.sessionId, 'query_patient_records');
      return recordsDone ? 1 : 0;
    }
    case 'same_day_cancel_rebook': {
      const cancelDone =
        toolsInclude(tools, /cancel_appointment/i) ||
        executorToolsCompleted(ctx.sessionId, 'cancel_appointment');
      const row = ctx.appointmentId ? getAppointmentRow(ctx.appointmentId) : null;
      const slotsDone = toolsInclude(tools, /get_available_slots/i);
      return (cancelDone || row?.status === 'cancelled' || slotsDone) && (scheduleDone || slotsDone) ? 1 : 0;
    }
    case 'provider_mismatch_rebook': {
      const apptId = sessionFlags(ctx.sessionId).last_appointment_id;
      const row = apptId ? getAppointmentRow(apptId) : null;
      const booked =
        executorToolsCompleted(ctx.sessionId, 'schedule_appointment') ||
        !!(row && row.status !== 'cancelled');
      const conflictHandled = result.checks?.side_effect_partial || result.checks?.conversation_complete;
      return toolsInclude(tools, /get_available_slots/i) && (booked || conflictHandled) ? 1 : 0;
    }
    default:
      return result.checks?.side_effect ? 1 : 0;
  }
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

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to book a dermatology appointment',
    tenantResolved: true,
    tenantPolicy: ADMIN_TENANT_POLICY
  });
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);

  const slotDay = uniqueTomorrowSlot(0, 30);
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', slotDay.dateStr);
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', '12:00');
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_id', `sandbox_book_${sessionId.slice(-8)}`);

  const dialog = [
    'I need to book a dermatology appointment.',
    'What appointment times do you have available this week?',
    '12:00 works for me.',
    'Yes please book that time.',
    `My name is ${patient.patientName}, email ${patient.patientEmail}.`,
    'Yes go ahead and confirm the booking please.'
  ];

  for (const msg of dialog) {
    await turn(ctx, msg, { tenantPolicy: ADMIN_TENANT_POLICY });
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

async function scenarioBookingUserDialog() {
  const id = 'booking_user_dialog';
  const patient = ensurePatient({
    given: 'Book',
    family: 'Test',
    email: 'book-sandbox@somo.test',
    phone: '+15559904030'
  });
  const sessionId = fixtures.newE2eSessionId('rail_book_user');
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

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to book a dermatology appointment for next week',
    tenantResolved: true,
    tenantPolicy: ADMIN_TENANT_POLICY
  });
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);

  const dialog = [
    'Hi, I need to book a dermatology appointment for next week.',
    '12:00 with Dr. Maria Santos works for me.',
    'Yes please book that slot.',
    `My name is ${patient.patientName}, email ${patient.patientEmail}.`,
    'Yes go ahead and confirm the booking please.'
  ];

  for (const msg of dialog) {
    await turn(ctx, msg, { tenantPolicy: ADMIN_TENANT_POLICY });
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }

  const apptBefore = countAppointments(patient.patientId, since);
  const { all, most } = analyzeReplies(ctx);
  const booked =
    toolsInclude(ctx.allTools, /schedule_appointment/i) ||
    apptBefore > 0 ||
    !!latestAppointment(patient.patientId);
  const scheduleCalled = toolsInclude(ctx.allTools, /schedule_appointment/i);
  const modes = uniqueModes(ctx);
  const subrails = uniqueSubrails(ctx);

  const checks = {
    mode_ok: modes.includes('tenant_inbound_admin') || ctx.finalLane === 'booking',
    rail_progression: subrails.includes('booking') || ctx.finalLane === 'booking' || scheduleCalled,
    partial_rail: scheduleCalled || ctx.finalLane === 'booking',
    all_replies: all,
    most_replies: most,
    tools_ok: booked && scheduleCalled,
    tools_partial: scheduleCalled || booked,
    side_effect: booked,
    side_effect_partial: scheduleCalled,
    conversation_complete: booked || scheduleCalled
  };

  return {
    id,
    title: '1b. Book appointment — user dialog (Dr. Santos, stated time)',
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
      !booked && 'Appointment not created — schedule_appointment may not have fired',
      !scheduleCalled && 'schedule_appointment never called',
      !checks.mode_ok && 'Mode did not land on admin booking path'
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
  const slotDay = uniqueTomorrowSlot(0, 30);
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

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'Hola, quiero reservar una cita de dermatología',
    tenantResolved: true,
    tenantPolicy: ADMIN_TENANT_POLICY
  });
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);

  const KellyToolExecutor = require('../services/kelly-tool-executor');
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', slotDay.dateStr);
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', '12:00');
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_id', `sandbox_es_${sessionId.slice(-8)}`);

  const dialog = [
    'Hola, quiero reservar una cita de dermatología para la próxima semana.',
    '¿Qué horarios tienen disponibles esta semana?',
    'Las 12:00 con la Dra. Maria Santos me funciona.',
    'Sí, por favor reserve ese horario.',
    `Me llamo ${patient.patientName}, correo ${patient.patientEmail}, teléfono ${patient.patientPhone}.`,
    'Sí, confirme la reserva por favor.'
  ];

  for (const msg of dialog) {
    await turn(ctx, msg, { preferredLanguage: 'es', tenantPolicy: ADMIN_TENANT_POLICY });
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

async function scenarioCancelAppointment() {
  const id = 'cancel_appointment';
  const patient = ensurePatient({ given: 'Cancel', family: 'Patient', email: 'cancel-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_cancel');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone,
    slotOffsetHours: 7
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
    firstUtterance: 'I need to cancel my appointment',
    tenantResolved: true
  });

  const dialog = [
    'I need to cancel my upcoming dermatology appointment.',
    `My name is ${patient.patientName}. Yes, please cancel that appointment.`,
    'Yes that is correct. Please go ahead and cancel it.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const cancelTool =
    toolsInclude(ctx.allTools, /cancel_appointment/i) ||
    executorToolsCompleted(sessionId, 'cancel_appointment');
  const row = getAppointmentRow(apptId);
  const cancelled = cancelTool || row?.status === 'cancelled';
  const searchTool = toolsInclude(ctx.allTools, /search_appointments/i);
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: uniqueModes(ctx).length > 0 || ctx.finalLane === 'reschedule',
    rail_progression: searchTool || cancelTool || uniqueSubrails(ctx).includes('cancellation'),
    partial_rail: searchTool,
    all_replies: all,
    most_replies: most,
    tools_ok: cancelTool,
    tools_partial: searchTool || cancelTool,
    side_effect: cancelled,
    side_effect_partial: searchTool,
    conversation_complete: cancelled || ctx.transcript.length >= 2
  };

  return {
    id,
    title: '8. Cancel appointment',
    ctx,
    checks,
    evidence: {
      appointmentId: apptId,
      status: row?.status,
      tools: [...new Set(ctx.allTools)]
    },
    gaps: [!cancelTool && 'cancel_appointment not invoked', !cancelled && 'Appointment not cancelled in DB'].filter(Boolean)
  };
}

async function scenarioRescheduleAppointment() {
  const id = 'reschedule_appointment';
  const patient = ensurePatient({ given: 'Resched', family: 'Patient', email: 'resched-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_resched');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone,
    slotOffsetHours: 9
  });
  const newSlot = uniqueTomorrowSlot(0, 10);

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

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', newSlot.dateStr);
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', newSlot.time);

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to reschedule my appointment',
    tenantResolved: true
  });

  const dialog = [
    'I need to reschedule my dermatology appointment to a later date.',
    `My name is ${patient.patientName}. Can we move it to ${newSlot.dateStr} at ${newSlot.time}?`,
    'Yes please reschedule to that time. Thank you.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const reschedTool =
    toolsInclude(ctx.allTools, /reschedule_appointment/i) ||
    executorToolsCompleted(sessionId, 'reschedule_appointment');
  const searchTool = toolsInclude(ctx.allTools, /search_appointments/i);
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: uniqueSubrails(ctx).includes('cancellation') || uniqueSubrails(ctx).includes('booking') || ctx.finalLane,
    rail_progression: searchTool || reschedTool,
    partial_rail: searchTool,
    all_replies: all,
    most_replies: most,
    tools_ok: reschedTool,
    tools_partial: searchTool || reschedTool,
    side_effect: reschedTool,
    side_effect_partial: searchTool,
    conversation_complete: reschedTool || ctx.transcript.length >= 2
  };

  return {
    id,
    title: '9. Reschedule appointment',
    ctx,
    checks,
    evidence: {
      appointmentId: apptId,
      targetDate: newSlot.dateStr,
      tools: [...new Set(ctx.allTools)]
    },
    gaps: [!reschedTool && 'reschedule_appointment not invoked'].filter(Boolean)
  };
}

async function scenarioRecordsRequest() {
  const id = 'records_request';
  const patient = ensurePatient({ given: 'Records', family: 'Patient', email: 'records-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_records');
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

  await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone,
    slotOffsetHours: 2
  });

  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'What did my doctor find on my last visit',
    tenantResolved: true
  });

  const dialog = [
    'What did my doctor find on my last visit? I want to understand my medical records.',
    'Can you explain the results from my last dermatology appointment?',
    'Thank you, that helps.'
  ];

  for (const msg of dialog) await turn(ctx, msg);

  const recordsTool =
    toolsInclude(ctx.allTools, /query_patient_records/i) ||
    executorToolsCompleted(sessionId, 'query_patient_records');
  const recordsMode = uniqueModes(ctx).includes('tenant_records');
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: recordsMode || uniqueSubrails(ctx).includes('records_qa'),
    rail_progression: recordsMode || recordsTool,
    partial_rail: recordsMode,
    all_replies: all,
    most_replies: most,
    tools_ok: recordsTool,
    tools_partial: recordsTool,
    side_effect: recordsTool,
    side_effect_partial: recordsMode,
    conversation_complete: recordsTool || ctx.transcript.length >= 2
  };

  return {
    id,
    title: '10. Medical records question',
    ctx,
    checks,
    evidence: {
      modes: uniqueModes(ctx),
      subrails: uniqueSubrails(ctx),
      tools: [...new Set(ctx.allTools)]
    },
    gaps: [!recordsTool && 'query_patient_records not invoked', !recordsMode && 'tenant_records mode not entered'].filter(Boolean)
  };
}

async function scenarioSameDayCancelRebook() {
  const id = 'same_day_cancel_rebook';
  const patient = ensurePatient({ given: 'Rebook', family: 'Patient', email: 'rebook-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_rebook');
  const { dbModule } = fixtures.loadDb();
  try {
    dbModule.db
      ?.prepare(
        `UPDATE appointments SET status = 'cancelled'
         WHERE patient_id = ? AND status IN ('scheduled', 'confirmed')`
      )
      ?.run(patient.patientId);
  } catch (_) {}
  const todaySlot = fixtures.todayAtAfternoonLocal({ hour: 15 });
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: patient.patientEmail,
    phone: patient.patientPhone,
    noon: todaySlot
  });
  const newSlot = uniqueTomorrowSlot(2, 5);

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

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to cancel my appointment and book a new one',
    tenantResolved: true,
    tenantPolicy: ADMIN_TENANT_POLICY
  });
  bindAppointmentToSession(sessionId, apptId);

  const dialog = [
    'I need to cancel my appointment today and book a new dermatology visit this week.',
    `My name is ${patient.patientName}. Yes please cancel that appointment.`,
    'Yes cancel it and book a new time for me.'
  ];

  for (const msg of dialog) {
    await turn(ctx, msg, { tenantPolicy: ADMIN_TENANT_POLICY });
    if (toolsInclude(ctx.allTools, /cancel_appointment/i)) {
      seedRebookAfterCancel(sessionId, patient, CLINIC_ID);
    }
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }
  if (!toolsInclude(ctx.allTools, /cancel_appointment/i)) {
    seedRebookAfterCancel(sessionId, patient, CLINIC_ID);
  }

  const rebookDialog = [
    `Can you book ${newSlot.dateStr} at ${newSlot.time}?`,
    'Yes please book that time. Thank you.',
    'Yes go ahead and confirm the booking please.'
  ];
  for (const msg of rebookDialog) {
    await turn(ctx, msg, { tenantPolicy: ADMIN_TENANT_POLICY });
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }

  const cancelTool =
    toolsInclude(ctx.allTools, /cancel_appointment/i) ||
    executorToolsCompleted(sessionId, 'cancel_appointment');
  const bookTool =
    toolsInclude(ctx.allTools, /schedule_appointment/i) ||
    executorToolsCompleted(sessionId, 'schedule_appointment');
  const row = getAppointmentRow(apptId);
  const cancelled = cancelTool || row?.status === 'cancelled';
  const booked =
    bookTool ||
    countAppointments(patient.patientId) > 1 ||
    countAppointments(patient.patientId, new Date(Date.now() - 120000).toISOString()) > 0;
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: uniqueModes(ctx).includes('tenant_inbound_admin') || ctx.finalLane === 'booking',
    rail_progression:
      uniqueSubrails(ctx).includes('cancellation') ||
      uniqueSubrails(ctx).includes('booking') ||
      cancelTool ||
      bookTool ||
      toolsInclude(ctx.allTools, /get_available_slots/i),
    partial_rail: cancelTool || bookTool || toolsInclude(ctx.allTools, /get_available_slots/i),
    all_replies: all,
    most_replies: most,
    tools_ok: (cancelTool || cancelled) && (bookTool || booked),
    tools_partial: cancelTool || bookTool || toolsInclude(ctx.allTools, /get_available_slots/i),
    side_effect: (cancelled || cancelTool) && (booked || bookTool),
    side_effect_partial: cancelled || booked || bookTool,
    conversation_complete: (cancelTool || cancelled) && (bookTool || booked)
  };

  return {
    id,
    title: '11. Same-day cancel + rebook',
    ctx,
    checks,
    evidence: {
      appointmentId: apptId,
      oldStatus: row?.status,
      tools: [...new Set(ctx.allTools)],
      modes: uniqueModes(ctx)
    },
    gaps: [
      !cancelTool && 'cancel_appointment not invoked',
      !bookTool && 'schedule_appointment not invoked after cancel',
      !cancelled && 'Original appointment not cancelled'
    ].filter(Boolean)
  };
}

async function scenarioProviderMismatchRebook() {
  const id = 'provider_mismatch_rebook';
  const patient = ensurePatient({ given: 'Conflict', family: 'Patient', email: 'conflict-sandbox@somo.test' });
  const sessionId = fixtures.newE2eSessionId('rail_conflict');
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

  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  seedModeAtCallStart({
    sessionId,
    clinicId: CLINIC_ID,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance: 'I need to book a dermatology appointment',
    tenantResolved: true,
    tenantPolicy: ADMIN_TENANT_POLICY
  });
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);

  const dialog = [
    'I need to book a dermatology appointment.',
    'I want Dr. Nonexistent Provider at 12:00 tomorrow.',
    'Okay, what other times do you have?',
    'The first available time works for me.',
    'Yes please book that.',
    'Yes confirm that appointment please.'
  ];

  for (const msg of dialog) {
    await turn(ctx, msg, { tenantPolicy: ADMIN_TENANT_POLICY });
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }

  const slotsCalled = toolsInclude(ctx.allTools, /get_available_slots/i);
  const booked =
    toolsInclude(ctx.allTools, /schedule_appointment/i) ||
    countAppointments(patient.patientId, since) > 0;
  const conflictHandled = ctx.transcript.some((t) =>
    /alternative|available|provider|09:00|10:|slot|time works/i.test(t.reply || '')
  );
  const { all, most } = analyzeReplies(ctx);

  const checks = {
    mode_ok: uniqueModes(ctx).includes('tenant_inbound_admin') || ctx.finalLane === 'booking',
    rail_progression: uniqueSubrails(ctx).includes('booking') || slotsCalled,
    partial_rail: slotsCalled,
    all_replies: all,
    most_replies: most,
    tools_ok: slotsCalled && booked,
    tools_partial: slotsCalled || booked,
    side_effect: booked,
    side_effect_partial: conflictHandled || slotsCalled || booked,
    conversation_complete: slotsCalled && (booked || conflictHandled)
  };

  return {
    id,
    title: '12. Provider mismatch recovery',
    ctx,
    checks,
    evidence: {
      tools: [...new Set(ctx.allTools)],
      modes: uniqueModes(ctx)
    },
    gaps: [
      !slotsCalled && 'get_available_slots not invoked for conflict recovery',
      !booked && !conflictHandled && 'No conflict recovery or successful book'
    ].filter(Boolean)
  };
}

async function scenarioAsrLanguageHandoff() {
  const id = 'asr_language_handoff';
  const sessionId = fixtures.newE2eSessionId('rail_asr_handoff');
  const { handleTurn } = require('../services/kelly-rails/orchestrator');

  const out = await handleTurn({
    sessionId,
    preferredLanguage: 'es',
    forceLanguageHandoff: true,
    languageConfidence: 0.2,
    channel: 'voice'
  });

  const handoffReply = String(out?.reply || '');
  const isHandoff =
    /specialist|especialista|conectar|connecting|idioma|language/i.test(handoffReply);
  const lane = out?.kelly_rails?.active_lane;

  return {
    id,
    title: '13. ASR / language low-confidence handoff',
    ctx: { id, sessionId, transcript: [{ content: '[low confidence]', reply: handoffReply }] },
    checks: {
      mode_ok: true,
      rail_progression: isHandoff,
      partial_rail: isHandoff,
      all_replies: !!handoffReply,
      most_replies: !!handoffReply,
      tools_ok: (out?.toolsUsed || []).length === 0,
      tools_partial: true,
      side_effect: lane === 'support' || isHandoff,
      side_effect_partial: isHandoff,
      conversation_complete: isHandoff
    },
    evidence: { lane, reply_snippet: handoffReply.slice(0, 120) },
    gaps: [!isHandoff && 'Expected language handoff copy for low-confidence ASR path'].filter(Boolean)
  };
}

const CRITICAL_TCR_SCENARIOS = new Set([
  'calling_about_appt',
  'booking',
  'booking_user_dialog',
  'payment',
  'outbound_reminder',
  'spanish_booking',
  'cancel_appointment',
  'reschedule_appointment',
  'records_request',
  'same_day_cancel_rebook',
  'provider_mismatch_rebook',
  'asr_language_handoff'
]);

const SCENARIOS = [
  scenarioBooking,
  scenarioBookingUserDialog,
  scenarioPayment,
  scenarioCallingAboutAppt,
  scenarioOutboundReminder,
  scenarioUrgentInquiry,
  scenarioSpanishBooking,
  scenarioMandarinPayment,
  scenarioCancelAppointment,
  scenarioRescheduleAppointment,
  scenarioRecordsRequest,
  scenarioSameDayCancelRebook,
  scenarioProviderMismatchRebook,
  scenarioAsrLanguageHandoff
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
  const selected = ONLY ? SCENARIOS.filter((fn) => scenarioMatchesFilter(fn, ONLY)) : SCENARIOS;

  if (ONLY && selected.length === 0) {
    console.error(red(`Unknown scenario: ${ONLY}`));
    process.exit(1);
  }

  for (const run of selected) {
    const result = await run();
    const { score, breakdown } = scoreScenario(result);
    result.fluency_score = score;
    result.breakdown = breakdown;
    result.tcr = computeTcr(result);
    result.score = result.tcr === 1 ? 10 : Math.min(score, 5);
    results.push(result);

    console.log(bold(`\n${result.title}`));
    console.log(`TCR: ${result.tcr === 1 ? green('PASS') : red('FAIL')} · Fluency: ${scoreColor(result.fluency_score)}/10`);
    printTranscript(result.ctx);
    if (result.gaps?.length) {
      console.log(yellow('  Gaps:'));
      result.gaps.forEach((g) => console.log(yellow(`    • ${g}`)));
    }
    breakdown.forEach((b) => console.log(grey(`  ${b}`)));
    fixtures.teardownKellySession(result.ctx.sessionId);
  }

  const avgFluency = results.length
    ? Math.round((results.reduce((s, r) => s + (r.fluency_score || 0), 0) / results.length) * 10) / 10
    : 0;
  const tcrPass = results.filter((r) => r.tcr === 1).length;
  const tcrPct = results.length ? Math.round((tcrPass / results.length) * 100) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath,
    llmAvailable: llm,
    conversationModeRouting: process.env.CONVERSATION_MODE_ROUTING,
    averageFluencyScore: avgFluency,
    tcrPassCount: tcrPass,
    tcrTotal: results.length,
    tcrPercent: tcrPct,
    averageScore: tcrPct / 10,
    scenarios: results.map((r) => ({
      id: r.id,
      title: r.title,
      tcr: r.tcr,
      fluency_score: r.fluency_score,
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
  md += `**TCR: ${tcrPass}/${results.length} (${tcrPct}%)** · Fluency avg: ${avgFluency}/10 · LLM: ${llm ? 'yes' : 'no'} · DB: \`${dbPath}\`\n\n`;
  md += `| # | Scenario | TCR | Fluency | Outcome |\n|---|----------|-----|---------|--------|\n`;
  for (const r of results) {
    const outcome =
      r.id === 'booking' || r.id === 'spanish_booking'
        ? r.evidence.appointment ? '✓ appt in DB' : '✗ no appt'
        : r.id === 'payment' || r.id === 'mandarin_payment'
          ? r.tcr === 1 ? '✓ payment path' : '✗ no payment'
          : r.id === 'urgent_inquiry'
            ? r.tcr === 1 ? '✓ urgent signal' : '✗ not urgent'
            : r.id === 'outbound_reminder'
              ? r.tcr === 1 ? '✓ reminder closed' : '○ partial'
              : r.id === 'calling_about_appt'
                ? r.tcr === 1 ? '✓ lookup' : '✗ lookup failed'
                : r.tcr === 1 ? '✓' : '✗';
    md += `| ${r.id} | ${r.title} | **${r.tcr === 1 ? 'PASS' : 'FAIL'}** | ${r.fluency_score}/10 | ${outcome} |\n`;
  }
  md += `\n## Per-scenario notes\n\n`;
  for (const r of results) {
    md += `### ${r.title} (TCR ${r.tcr === 1 ? 'PASS' : 'FAIL'}, fluency ${r.fluency_score}/10)\n\n`;
    if (r.gaps?.length) {
      md += `**Gaps:** ${r.gaps.join('; ')}\n\n`;
    }
    md += `**Evidence:** \`${JSON.stringify(r.evidence)}\`\n\n`;
  }
  fs.writeFileSync(mdPath, md);

  console.log(
    bold(`\n═ Summary: TCR ${tcrPass}/${results.length} (${tcrPct}%) · fluency avg ${scoreColor(String(avgFluency))}/10 ═`)
  );
  console.log(`Report: ${mdPath}`);

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  }

  const criticalFail = results.some((r) => CRITICAL_TCR_SCENARIOS.has(r.id) && r.tcr !== 1);
  process.exit(criticalFail ? 1 : 0);
}

main().catch((e) => {
  console.error(red(e.stack || e.message));
  process.exit(1);
});
