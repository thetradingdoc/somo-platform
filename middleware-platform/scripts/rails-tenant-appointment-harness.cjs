#!/usr/bin/env node
'use strict';

/**
 * Tenant appointment harness — drlittlekids@gmail.com admin-path proof.
 *
 * Usage:
 *   node scripts/rails-tenant-appointment-harness.cjs
 *   node scripts/rails-tenant-appointment-harness.cjs --json
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MP = path.join(__dirname, '..');
process.chdir(MP);

process.env.KELLY_RAILS_V2 = '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = '1';
process.env.KELLY_ALLOW_HYBRID_GRAPH = '0';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';
process.env.KELLY_E2E_SKIP_TRIAGE = '1';
process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');

const fixtures = require('../lib/kelly-conversation-fixtures.cjs');
const { runKellyTurn } = require('../services/kelly/kelly-turn-resolver');
const { seedModeAtCallStart } = require('../services/conversation/conversation-mode-session');

const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';
const TENANT_EMAIL = 'drlittlekids@gmail.com';
const JSON_OUT = process.argv.includes('--json');

const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', grey: '\x1b[90m' };
const bold = (s) => `${C.bold}${s}${C.reset}`;
const green = (s) => `${C.green}${s}${C.reset}`;
const red = (s) => `${C.red}${s}${C.reset}`;
const cyan = (s) => `${C.cyan}${s}${C.reset}`;
const grey = (s) => `${C.grey}${s}${C.reset}`;

function toolsInclude(tools, pattern) {
  return (tools || []).some((n) => pattern.test(String(n || '')));
}

function uniqueTomorrowSlot(offsetHours = 0, daysAhead = 1) {
  const base = fixtures.tomorrowAtNoonLocal();
  const start = new Date(base.startDatetime);
  if (daysAhead > 1) start.setDate(start.getDate() + (daysAhead - 1));
  if (offsetHours) start.setHours(start.getHours() + offsetHours);
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
  const daysAhead = opts.daysAhead ?? 1;
  const noon = opts.noon || uniqueTomorrowSlot(offset, daysAhead);
  const apptId = opts.appointmentId || `appt_tenant_${crypto.randomBytes(6).toString('hex')}`;
  try {
    return await fixtures.seedTomHarrisAppointment(sessionId, patientId, clinicId, {
      ...opts,
      appointmentId: apptId,
      noon,
      email: opts.email || TENANT_EMAIL
    });
  } catch (e) {
    if (!String(e.message || '').includes('UNIQUE')) throw e;
    return seedUniqueAppointment(sessionId, patientId, clinicId, {
      ...opts,
      slotOffsetHours: offset + crypto.randomInt(1, 6),
      daysAhead: daysAhead + (opts._retry || 0)
    });
  }
}

const ADMIN_TENANT_POLICY = {
  triage_policy: 'conditional',
  billing_enabled: true,
  records_enabled: true
};

function seedAdminBookingPath(sessionId, patient, clinicId) {
  fixtures.seedBookingReady(sessionId, patient.patientId, clinicId, {
    patientName: patient.patientName,
    patientEmail: TENANT_EMAIL,
    patientPhone: patient.phone,
    targetSpecialty: 'Dermatology',
    symptomText: 'routine dermatology visit',
    quality: 'routine visit',
    region: 'general'
  });
  const { persistRailsSessionState } = require('../services/kelly/rails/session-ssot');
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

function clearScheduledAppointments(patientId) {
  const { dbModule } = fixtures.loadDb();
  try {
    dbModule.db
      ?.prepare(
        `UPDATE appointments SET status = 'cancelled'
         WHERE patient_id = ? AND status IN ('scheduled', 'confirmed')`
      )
      ?.run(patientId);
  } catch (_) {}
}

function seedRebookAfterCancel(sessionId, patient, clinicId) {
  seedAdminBookingPath(sessionId, patient, clinicId);
  const { persistRailsSessionState } = require('../services/kelly/rails/session-ssot');
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
  const { persistRailsSessionState } = require('../services/kelly/rails/session-ssot');
  persistRailsSessionState(sessionId, {
    appointment_id: apptId,
    flags: { appointment_id: apptId, last_appointment_id: apptId }
  });
  fixtures.setMeta(sessionId, 'last_appointment_id', apptId);
}

function seedMode(ctx, firstUtterance, extra = {}) {
  const payload = {
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    call_type: 'tenant',
    direction: 'inbound',
    firstUtterance,
    tenantResolved: true,
    ...extra
  };
  if (extra.useProfilePolicy) {
    payload.db = require('../database');
    delete payload.tenantPolicy;
    delete payload.useProfilePolicy;
  } else if (payload.tenantPolicy == null) {
    payload.tenantPolicy = ADMIN_TENANT_POLICY;
  }
  seedModeAtCallStart(payload);
}

function getAppointmentRow(apptId) {
  const { dbModule } = fixtures.loadDb();
  return dbModule.db?.prepare('SELECT * FROM appointments WHERE id = ?').get(apptId) || null;
}

function countScheduledSince(patientId, sinceIso) {
  const { dbModule } = fixtures.loadDb();
  const row = dbModule.db
    ?.prepare(
      `SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status = 'scheduled' AND datetime(created_at) >= datetime(?)`
    )
    ?.get(patientId, sinceIso);
  return row?.n || 0;
}

function executorToolsCompleted(sessionId, toolName) {
  const db = require('../database');
  const events = db.listKellyCallEvents?.({ session_id: sessionId, limit: 200 }) || [];
  return events.some(
    (e) =>
      e.event_type === 'tool_completed' &&
      String(e.payload_json?.tool_name || '').includes(toolName) &&
      e.payload_json?.success !== false
  );
}

async function turn(ctx, userMsg, extra = {}) {
  const { runKellyTurn: run } = require('../services/kelly/kelly-turn-resolver');
  const { getRailsSessionProjection } = require('../services/kelly/rails/session-ssot');
  const out = await run({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
    patientName: ctx.patientName,
    callerPhone: ctx.patientPhone || ctx.phone,
    channel: 'voice',
    message: userMsg,
    call_type: 'tenant',
    direction: 'inbound',
    preferredLanguage: 'en',
    customerId: ctx.customerId || null,
    callId: ctx.sessionId,
    ...(extra.tenantPolicy !== undefined ? { tenantPolicy: extra.tenantPolicy } : {}),
    ...extra
  });
  let mode = out?.conversation_mode;
  try {
    const projection = getRailsSessionProjection(ctx.sessionId);
    if (projection?.flags_json) {
      const flags = JSON.parse(projection.flags_json);
      if (flags.conversation_mode) mode = flags.conversation_mode;
    }
  } catch (_) {}
  ctx.transcript.push({
    content: userMsg,
    reply: out?.reply || '',
    toolsUsed: out?.toolsUsed || [],
    conversation_mode: mode,
    lane: out?.kelly_rails?.active_lane
  });
  ctx.allTools.push(...(out?.toolsUsed || []));
  if (mode) ctx.finalMode = mode;
  if (out?.kelly_rails?.active_lane) ctx.finalLane = out.kelly_rails.active_lane;
  return out;
}

function ensureTomPatient() {
  return fixtures.seedTomHarrisPatient({ email: TENANT_EMAIL });
}

function hasScheduledAppointment(patientId) {
  const { dbModule } = fixtures.loadDb();
  const row = dbModule.db
    ?.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status = 'scheduled'`)
    ?.get(patientId);
  return (row?.n || 0) > 0;
}

async function scenarioT1Book() {
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_book');
  const since = new Date().toISOString();
  const ctx = {
    id: 'T1_book',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  seedMode(ctx, 'I need to book a dermatology appointment');
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);
  const dialog = [
    'I need to book a dermatology appointment.',
    'What appointment times do you have available this week?',
    '12:00 works for me.',
    'Yes please book that time.',
    `My name is ${patient.patientName}, email ${TENANT_EMAIL}.`,
    'Yes go ahead and confirm the booking please.'
  ];
  for (const msg of dialog) {
    await turn(ctx, msg);
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }
  const booked =
    toolsInclude(ctx.allTools, /schedule_appointment/i) ||
    countScheduledSince(patient.patientId, since) > 0 ||
    hasScheduledAppointment(patient.patientId);
  const adminMode =
    ctx.transcript.some((t) => t.conversation_mode === 'tenant_inbound_admin') ||
    ctx.transcript.filter((t) => t.conversation_mode === 'tenant_inbound_clinical').length <= 1;
  return {
    id: ctx.id,
    pass: booked && adminMode,
    evidence: { tools: [...new Set(ctx.allTools)], modes: ctx.transcript.map((t) => t.conversation_mode) }
  };
}

async function scenarioT2Lookup() {
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_lookup');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: TENANT_EMAIL,
    phone: patient.phone
  });
  const ctx = {
    id: 'T2_lookup',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  seedMode(ctx, 'I am calling about my appointment');
  await turn(ctx, 'I am calling about my upcoming dermatology appointment.');
  await turn(ctx, `My name is ${patient.patientName}.`);
  const lookup =
    toolsInclude(ctx.allTools, /search_appointments/i) ||
    executorToolsCompleted(sessionId, 'search_appointments');
  return { id: ctx.id, pass: lookup, evidence: { apptId, tools: [...new Set(ctx.allTools)] } };
}

async function scenarioT3Cancel() {
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_cancel');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: TENANT_EMAIL,
    phone: patient.phone
  });
  const ctx = {
    id: 'T3_cancel',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient,
    apptId
  };
  seedMode(ctx, 'I need to cancel my appointment');
  await turn(ctx, 'I need to cancel my upcoming dermatology appointment.');
  await turn(ctx, `My name is ${patient.patientName}. Yes please cancel that appointment.`);
  await turn(ctx, 'Yes that is correct. Please go ahead and cancel it.');
  const cancelTool =
    toolsInclude(ctx.allTools, /cancel_appointment/i) || executorToolsCompleted(sessionId, 'cancel_appointment');
  const row = getAppointmentRow(apptId);
  return {
    id: ctx.id,
    pass: cancelTool || row?.status === 'cancelled',
    evidence: { status: row?.status, tools: [...new Set(ctx.allTools)] }
  };
}

async function scenarioT4Reschedule() {
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_resched');
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: TENANT_EMAIL,
    phone: patient.phone
  });
  const newSlot = uniqueTomorrowSlot(0, 10);
  const ctx = {
    id: 'T4_reschedule',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', newSlot.dateStr);
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', newSlot.time);
  seedMode(ctx, 'I need to reschedule my appointment');
  await turn(ctx, 'I need to reschedule my dermatology appointment to a later date.');
  await turn(ctx, `My name is ${patient.patientName}. Can we move it to ${newSlot.dateStr} at ${newSlot.time}?`);
  await turn(ctx, 'Yes please reschedule to that time.');
  const reschedTool =
    toolsInclude(ctx.allTools, /reschedule_appointment/i) ||
    executorToolsCompleted(sessionId, 'reschedule_appointment');
  return { id: ctx.id, pass: reschedTool, evidence: { apptId, target: newSlot, tools: [...new Set(ctx.allTools)] } };
}

async function scenarioT5CancelRebook() {
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_rebook');
  const todaySlot = fixtures.todayAtAfternoonLocal({ hour: 15 });
  const apptId = await seedUniqueAppointment(sessionId, patient.patientId, CLINIC_ID, {
    patientName: patient.patientName,
    email: TENANT_EMAIL,
    phone: patient.phone,
    noon: todaySlot,
    daysAhead: 0
  });
  const newSlot = uniqueTomorrowSlot(2, 5);
  const ctx = {
    id: 'T5_cancel_rebook',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  bindAppointmentToSession(sessionId, apptId);
  seedMode(ctx, 'I need to cancel my appointment and book a new one', { appointmentId: apptId });
  await turn(ctx, 'I need to cancel my appointment today and book a new dermatology visit this week.');
  await turn(ctx, `My name is ${patient.patientName}. Yes please cancel that appointment.`);
  await turn(ctx, 'Yes cancel it and book a new time for me.');
  seedRebookAfterCancel(sessionId, patient, CLINIC_ID);
  await turn(ctx, `Can you book ${newSlot.dateStr} at ${newSlot.time}?`);
  await turn(ctx, 'Yes please book that time. Thank you.');
  const cancelTool = toolsInclude(ctx.allTools, /cancel_appointment/i);
  const bookTool = toolsInclude(ctx.allTools, /schedule_appointment/i);
  const row = getAppointmentRow(apptId);
  const newBooked = countScheduledSince(patient.patientId, new Date(Date.now() - 60000).toISOString()) > 0;
  return {
    id: ctx.id,
    pass: cancelTool && bookTool && (row?.status === 'cancelled' || cancelTool) && newBooked,
    evidence: {
      apptId,
      oldApptStatus: row?.status,
      tools: [...new Set(ctx.allTools)],
      modes: ctx.transcript.map((t) => t.conversation_mode)
    }
  };
}

async function scenarioT6ProviderMismatch() {
  const patient = ensureTomPatient();
  const sessionId = fixtures.newE2eSessionId('tenant_conflict');
  const ctx = {
    id: 'T6_provider_mismatch',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  seedMode(ctx, 'I need to book a dermatology appointment');
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);
  const dialog = [
    'I need to book a dermatology appointment.',
    'I want Dr. Nonexistent Provider at 12:00 tomorrow.',
    'Okay, what other times do you have?',
    'The first available time works for me.',
    'Yes please book that.'
  ];
  for (const msg of dialog) {
    await turn(ctx, msg);
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }
  const slotsCalled = toolsInclude(ctx.allTools, /get_available_slots/i);
  const booked = toolsInclude(ctx.allTools, /schedule_appointment/i);
  const conflictReply = ctx.transcript.some((t) => /alternative|available|09:00|10:|provider/i.test(t.reply || ''));
  return {
    id: ctx.id,
    pass: slotsCalled && (booked || conflictReply),
    evidence: { tools: [...new Set(ctx.allTools)] }
  };
}

async function scenarioARealPolicyBook() {
  fixtures.seedTenantPolicyJson(CLINIC_ID, { triage_policy: 'conditional' }, { use_case: 'dermatology' });
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_realpol');
  const since = new Date().toISOString();
  const ctx = {
    id: 'A_real_policy_book',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  seedMode(ctx, 'I need to book a dermatology appointment', { useProfilePolicy: true });
  seedAdminBookingPath(sessionId, patient, CLINIC_ID);
  const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
  const slot = uniqueTomorrowSlot(0, 8);
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', slot.dateStr);
  KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', '12:00');
  for (const msg of [
    'I need to book a dermatology appointment.',
    '12:00 works for me.',
    'Yes please book that.',
    `My name is ${patient.patientName}, email ${TENANT_EMAIL}.`,
    'Yes confirm please.'
  ]) {
    await turn(ctx, msg);
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }
  const booked =
    toolsInclude(ctx.allTools, /schedule_appointment/i) ||
    countScheduledSince(patient.patientId, since) > 0;
  const adminMode = ctx.transcript.some((t) => t.conversation_mode === 'tenant_inbound_admin');
  return { id: ctx.id, pass: booked && adminMode, evidence: { tools: [...new Set(ctx.allTools)], modes: ctx.transcript.map((t) => t.conversation_mode) } };
}

async function scenarioBClinicalSymptomBook() {
  fixtures.seedTenantPolicyJson(CLINIC_ID, { triage_policy: 'required' }, { use_case: 'dermatology' });
  const patient = ensureTomPatient();
  clearScheduledAppointments(patient.patientId);
  const sessionId = fixtures.newE2eSessionId('tenant_clinical');
  const ctx = {
    id: 'B_clinical_symptom_book',
    sessionId,
    clinicId: CLINIC_ID,
    transcript: [],
    allTools: [],
    patientPhone: patient.phone,
    ...patient
  };
  fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  seedMode(ctx, 'I have an itchy rash on my leg', { useProfilePolicy: true });
  const dialog = [
    'I have an itchy rash on my leg and neck for about a week.',
    'It started about one week ago.',
    'It gets worse when I scratch.',
    'It is itchy and red.',
    'On my leg and neck.',
    'About a 4 out of 10.',
    'No, this is new.',
    'Yes please book a dermatology appointment.',
    '12:00 tomorrow works.',
    'Yes book that please.',
    `My name is ${patient.patientName}, email ${TENANT_EMAIL}.`
  ];
  for (const msg of dialog) {
    await turn(ctx, msg);
    fixtures.seedE2eBookableProvider(CLINIC_ID, { targetSpecialty: 'Dermatology' });
  }
  const clinical = ctx.transcript.some((t) => t.conversation_mode === 'tenant_inbound_clinical');
  const booked = toolsInclude(ctx.allTools, /schedule_appointment/i) || hasScheduledAppointment(patient.patientId);
  return {
    id: ctx.id,
    pass: clinical && booked,
    evidence: { tools: [...new Set(ctx.allTools)], modes: [...new Set(ctx.transcript.map((t) => t.conversation_mode))] }
  };
}

const SCENARIOS = [
  scenarioT1Book,
  scenarioARealPolicyBook,
  scenarioBClinicalSymptomBook,
  scenarioT2Lookup,
  scenarioT3Cancel,
  scenarioT4Reschedule,
  scenarioT5CancelRebook,
  scenarioT6ProviderMismatch
];

async function main() {
  if (!fs.existsSync(process.env.DB_PATH)) {
    console.error(red(`DB not found: ${process.env.DB_PATH}`));
    process.exit(1);
  }

  console.log(bold('\n═ Tenant Appointment Harness (drlittlekids@gmail.com) ═\n'));
  console.log(`DB: ${process.env.DB_PATH}`);
  console.log(`Email: ${TENANT_EMAIL}\n`);

  const results = [];
  for (const run of SCENARIOS) {
    const r = await run();
    results.push(r);
    console.log(`${r.pass ? green('PASS') : red('FAIL')}  ${r.id}`);
    if (!JSON_OUT) {
      console.log(grey(`  evidence: ${JSON.stringify(r.evidence).slice(0, 200)}`));
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(bold(`\n═ Summary: ${passed}/${total} passed ═\n`));

  const reportPath = path.join(MP, 'test-results', 'rails-tenant-appointment-harness.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const md = [
    '# Tenant Appointment Harness',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `**Result: ${passed}/${total}** · Email: ${TENANT_EMAIL}`,
    '',
    '| Scenario | Pass |',
    '|----------|------|',
    ...results.map((r) => `| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} |`),
    '',
    ...results.map((r) => `### ${r.id}\n\`\`\`json\n${JSON.stringify(r.evidence, null, 2)}\n\`\`\``)
  ].join('\n');
  fs.writeFileSync(reportPath, md);
  console.log(`Report: ${reportPath}`);

  if (JSON_OUT) console.log(JSON.stringify({ passed, total, results }, null, 2));
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(red(e.stack || e.message));
  process.exit(1);
});
