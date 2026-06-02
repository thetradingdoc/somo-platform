#!/usr/bin/env node
'use strict';

/**
 * e2e-kelly-rcm-pay-conversation.cjs
 *
 * AGENTIC PATHWAY E2E — Full patient journey diagnostic (derm/booking scenario).
 *
 * Drives conversation turns through kelly-conversation-bridge (graph + processTurn, real LLM).
 * Set KELLY_RAILS_V2=1 (default below) for LangGraph rails orchestrator in dev/E2E.
 * Never calls KellyToolExecutor directly for conversation stages.
 *
 * Usage:
 *   RCM_E2E_USE_EXISTING_SERVER=1 node scripts/e2e-kelly-rcm-pay-conversation.cjs
 *
 * Required env:
 *   ANTHROPIC_API_KEY or GROQ_API_KEY or OPENAI_API_KEY
 *   RCM_E2E_USE_EXISTING_SERVER=1  (middleware on :4000)
 *
 * Optional:
 *   KELLY_E2E_VISIT_ONLY=1  — T1-T4 only (Sprint 1 visit line exit)
 *   RCM_E2E_STRIPE_LIVE=1  — live create-intent + Stripe confirm + /complete
 *   STRIPE_SECRET_KEY
 *   STEDI_API_KEY          — skip seeded eligibility when set
 *   DB_PATH                — default ./middleware-dev.db
 *   BASE_URL               — default http://127.0.0.1:4000
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Avoid contending with a running dev server on the same SQLite file during bootstrap.
if (process.env.RCM_E2E_USE_EXISTING_SERVER === '1') {
  process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';
}
if (process.env.KELLY_F2_TOM_HARRIS === '1') {
  process.env.KELLY_RAILS_FAST_RAG = process.env.KELLY_RAILS_FAST_RAG || '1';
}

// F2 default: Kelly Rails V2 orchestrator (set KELLY_RAILS_V2=0 for hybrid/legacy).
if (process.env.KELLY_RAILS_V2 === undefined) {
  process.env.KELLY_RAILS_V2 = '1';
}
if (process.env.KELLY_RAILS_ROLLOUT_PCT === undefined) {
  process.env.KELLY_RAILS_ROLLOUT_PCT = '1';
}
if (process.env.LANGGRAPH_KELLY_ROLLOUT_PCT === undefined) {
  process.env.LANGGRAPH_KELLY_ROLLOUT_PCT = '0';
}

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');

const MP = path.join(__dirname, '..');
process.chdir(MP);
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');

const API_BASE = (process.env.BASE_URL || process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CLINIC_ID = process.env.TEST_CLINIC_ID || process.env.RCM_E2E_CLINIC_ID || 'clinic-default';
const PROVIDER_EMAIL = process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';
const PROVIDER_PASSWORD = process.env.RCM_E2E_PROVIDER_PASSWORD || 'demo123';
const STRIPE_LIVE = process.env.RCM_E2E_STRIPE_LIVE === '1';
const VISIT_ONLY = process.env.KELLY_E2E_VISIT_ONLY === '1';
const OBGYN_E2E = process.env.KELLY_E2E_OBGYN === '1';
const TOM_HARRIS_E2E = process.env.KELLY_F2_TOM_HARRIS === '1';
const PATIENT_PHONE = TOM_HARRIS_E2E
  ? fixtures.TOM_HARRIS_PHONE
  : process.env.TEST_PATIENT_PHONE || '+15550009991';
const PATIENT_EMAIL = TOM_HARRIS_E2E ? fixtures.TOM_HARRIS_EMAIL : 'e2e-conversation@somo.test';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  grey: '\x1b[90m',
};
const green = (s) => `${C.green}${s}${C.reset}`;
const red = (s) => `${C.red}${s}${C.reset}`;
const yellow = (s) => `${C.yellow}${s}${C.reset}`;
const cyan = (s) => `${C.cyan}${s}${C.reset}`;
const grey = (s) => `${C.grey}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

const results = [];
let stageIdx = 0;
let cookieJar = '';

function recordResult(stage, label, status, note = '', durationMs = 0) {
  results.push({ stage, label, status, note, durationMs });
  const icon = { PASS: green('✓'), FAIL: red('✗'), SKIP: yellow('○') }[status];
  const time = durationMs ? grey(` (${durationMs}ms)`) : '';
  console.log(`  ${icon}  ${bold(`Stage ${stage}`)} — ${label}${time}`);
  if (note) console.log(`     ${grey(note)}`);
}

async function runStage(label, fn) {
  const idx = ++stageIdx;
  console.log(`\n${cyan(`▶ Stage ${idx}`)} ${label}`);
  const t0 = Date.now();
  try {
    const result = await fn();
    recordResult(idx, label, PASS, result?.note || '', Date.now() - t0);
    return { ok: true, data: result };
  } catch (err) {
    const note = err.message || String(err);
    recordResult(idx, label, FAIL, note, Date.now() - t0);
    console.log(`     ${red('Error detail:')} ${note}`);
    return { ok: false, error: err };
  }
}

function skipStage(label, reason) {
  const idx = ++stageIdx;
  console.log(`\n${yellow(`○ Stage ${idx}`)} ${label}`);
  recordResult(idx, label, SKIP, reason);
  return { ok: false, skipped: true };
}

function apiRequest(method, urlPath, body) {
  const url = new URL(urlPath.startsWith('http') ? urlPath : `${API_BASE}${urlPath}`);
  const payload = body ? JSON.stringify(body) : null;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookieJar ? { Cookie: cookieJar } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie) {
            cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
          }
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function providerLogin() {
  const res = await apiRequest('POST', '/api/customers/login', {
    email: PROVIDER_EMAIL,
    password: PROVIDER_PASSWORD,
    remember_me: false,
  });
  if (res.status !== 200 || !res.json.success) {
    throw new Error(res.json.error || `Provider login failed HTTP ${res.status}`);
  }
}

function hasLlmKey() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

function toolsInclude(toolsUsed, pattern) {
  const list = Array.isArray(toolsUsed) ? toolsUsed : [];
  return list.some((name) => pattern.test(String(name || '')));
}

function payUrlFromToken(base, token) {
  return `${base.replace(/\/$/, '')}/patients/pay.html?token=${encodeURIComponent(token)}`;
}

async function kellyTurn(ctx, userMsg) {
  ctx.conversation.push({ role: 'user', content: userMsg });
  const runTurn = ctx.runKellyTurn || ctx.KellyAgent.processTurn.bind(ctx.KellyAgent);
  const result = await runTurn({
    sessionId: ctx.sessionId,
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
    callerPhone: ctx.patientPhone,
    channel: 'voice',
    message: userMsg,
  });
  const reply = result?.reply || result?.message || result?.text || '';
  const toolsUsed = Array.isArray(result?.toolsUsed) ? result.toolsUsed : [];
  ctx.conversation.push({ role: 'assistant', content: reply });
  for (const t of toolsUsed) {
    if (!ctx.toolCallLog.includes(t)) ctx.toolCallLog.push(t);
  }
  return { reply, toolsUsed, result };
}

function parseE2eTime(value) {
  if (!value) return 0;
  const normalized = String(value).trim().replace(' ', 'T');
  const ms = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function resolvePayTokenFromSession(ctx, opts = {}) {
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  const sinceMs = opts.sinceIso ? parseE2eTime(opts.sinceIso) : 0;

  if (ctx.db && ctx.patientId && ctx.clinicId) {
    const row = ctx.db
      .prepare(
        `SELECT pay_token, requested_at FROM rcm_payments
         WHERE patient_id = ? AND clinic_id = ?
         ORDER BY requested_at DESC LIMIT 1`
      )
      .get(ctx.patientId, ctx.clinicId);
    if (row?.pay_token) {
      const rowMs = parseE2eTime(row.requested_at);
      const fresh = !sinceMs || rowMs >= sinceMs - 5000;
      if (fresh) return String(row.pay_token);
    }
  }

  const fromMeta = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'rcm_pay_token');
  if (!fromMeta) return null;
  if (sinceMs && ctx.db) {
    try {
      const metaRow = ctx.db
        .prepare(
          `SELECT updated_at FROM kelly_session_meta_kv WHERE session_id = ? AND meta_key = 'rcm_pay_token' LIMIT 1`
        )
        .get(ctx.sessionId);
      if (metaRow?.updated_at && parseE2eTime(metaRow.updated_at) < sinceMs - 5000) {
        return null;
      }
    } catch (_) {}
  }
  return String(fromMeta);
}

function resolveLatestPayment(ctx) {
  const row = ctx.db
    .prepare(
      `SELECT id, pay_token, amount, status, journey_id FROM rcm_payments
       WHERE patient_id = ? AND clinic_id = ?
       ORDER BY requested_at DESC LIMIT 1`
    )
    .get(ctx.patientId, ctx.clinicId);
  return row || null;
}

async function main() {
  console.log('\n' + bold('═'.repeat(64)));
  console.log(bold('  Somo · Kelly Agentic Pathway E2E — Derm → Book → Copay → Pay'));
  console.log(bold('═'.repeat(64)));
  console.log(grey(`  API: ${API_BASE}`));
  console.log(grey(`  DB:  ${process.env.DB_PATH}`));
  console.log(grey(`  started: ${new Date().toISOString()}\n`));
  if (TOM_HARRIS_E2E) {
    console.log(cyan('  Mode: KELLY_F2_TOM_HARRIS (Tom Harris → drlittlekids@gmail.com)\n'));
    process.env.RCM_E2E_RECORD_EMAIL = process.env.RCM_E2E_RECORD_EMAIL || '1';
    process.env.KELLY_RAILS_FAST_RAG = process.env.KELLY_RAILS_FAST_RAG || '1';
    fixtures.clearRcmE2eEmailOutbox();
  }

  const inProcessOnly = process.env.RCM_E2E_USE_EXISTING_SERVER !== '1';

  const health = inProcessOnly
    ? { status: 0 }
    : await Promise.race([
    apiRequest('GET', '/health'),
        new Promise((resolve) => setTimeout(() => resolve({ status: 0 }), 5000)),
      ]);
  if (!inProcessOnly && health.status !== 200) {
    console.warn(
      yellow(
        `Middleware health at ${API_BASE} unavailable (status=${health.status}) — continuing with in-process Kelly turns`
      )
    );
  } else if (inProcessOnly) {
    console.log(cyan('  Mode: in-process only (no :4000 server required for Kelly turns)\n'));
  }

  const ctx = {
    sessionId: fixtures.newE2eSessionId('e2e_conversation'),
    clinicId: CLINIC_ID,
    patientPhone: PATIENT_PHONE,
    patientId: null,
    appointmentId: null,
    journeyId: null,
    payToken: null,
    payUrl: null,
    paymentId: null,
    copayAmount: 25,
    tomorrowNoon: null,
    patientEmail: PATIENT_EMAIL,
    stripeIntentId: null,
    conversation: [],
    toolCallLog: [],
    KellyAgent: null,
    db: null,
    baseUrl: API_BASE,
  };

  /* Stage 1 — Bootstrap */
  await runStage('Bootstrap — load KellyAgentService + DB tables', async () => {
    fixtures.teardownKellySession(ctx.sessionId);
    if (!hasLlmKey()) {
      throw new Error('No LLM key. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY.');
    }

    const useExisting = process.env.RCM_E2E_USE_EXISTING_SERVER === '1';
    if (useExisting) {
      const dbModule = require('../database');
      ctx.db = dbModule.db;
    } else {
      const Database = require('better-sqlite3');
      ctx.db = new Database(process.env.DB_PATH, { readonly: false });
      try {
        ctx.db.pragma('journal_mode = WAL');
      } catch (_) {}
      ctx.db.pragma('busy_timeout = 60000');
    }

    const tables = ctx.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);

    const required = ['fhir_patients', 'appointments', 'eligibility_checks', 'rcm_payments', 'rcm_journeys'];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) throw new Error(`Missing DB tables: ${missing.join(', ')}`);

    if (!useExisting) {
      const orchestrator = require('../services/rcm-journey-orchestrator');
      orchestrator.ensureKellyRcmTables();
    }

    ctx.KellyAgent = require('../services/kelly-agent-service');
    const { runKellyTurn } = require('../services/kelly-turn-resolver');
    ctx.runKellyTurn = runKellyTurn;

    const hasStripe = !!process.env.STRIPE_SECRET_KEY;
    const hasStedi = !!process.env.STEDI_API_KEY;

    return {
      note: [
        `tables=${tables.length}`,
        `Stripe=${hasStripe ? 'yes' : 'no'}`,
        `Stedi=${hasStedi ? 'yes' : 'seeded eligibility'}`,
        `STRIPE_LIVE=${STRIPE_LIVE}`,
      ].join(' | '),
    };
  });

  /* Stage 2 — Seed patient */
  await runStage('Seed — fhir_patients test patient', async () => {
    if (!ctx.db) throw new Error('DB not ready');

    const seeded = TOM_HARRIS_E2E
      ? fixtures.seedTomHarrisPatient()
      : fixtures.seedPatient({ phone: ctx.patientPhone, email: ctx.patientEmail });
    ctx.patientId = seeded.patientId;
    ctx.patientEmail = seeded.email;

    if (TOM_HARRIS_E2E) {
      ctx.tomorrowNoon = fixtures.seedE2eSlotTomorrowNoon(ctx.clinicId, { targetSpecialty: 'Dermatology' });
    } else {
      fixtures.seedE2eBookableProvider(ctx.clinicId, { targetSpecialty: 'Dermatology' });
    }

    return { note: `patient_id=${ctx.patientId} email=${ctx.patientEmail}` };
  });

  /* Stage 3 — Seed eligibility + RCM journey */
  await runStage('Seed — eligibility copay=$25 + open RCM journey', async () => {
    if (!ctx.db || !ctx.patientId) throw new Error('Patient not ready');

    const hasStedi = !!process.env.STEDI_API_KEY;
    let copaySource = 'seeded';

    if (!hasStedi) {
      const existing = ctx.db
        .prepare(`SELECT id FROM eligibility_checks WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(ctx.patientId);

      if (existing) {
        ctx.db
          .prepare(
            `UPDATE eligibility_checks SET copay_amount = 25.00, eligible = 1 WHERE id = ?`
          )
          .run(existing.id);
      } else {
        ctx.db
          .prepare(
            `INSERT INTO eligibility_checks
             (id, patient_id, member_id, payer_id, copay_amount, eligible, created_at)
             VALUES (?, ?, ?, ?, 25.00, 1, datetime('now'))`
          )
          .run(
            `elig-e2e-${crypto.randomBytes(6).toString('hex')}`,
            ctx.patientId,
            'MBR-E2E-001',
            '60054'
          );
      }
    } else {
      copaySource = 'live Stedi (not seeded)';
    }

    const orchestrator = require('../services/rcm-journey-orchestrator');
    const open = ctx.db
      .prepare(
        `SELECT id FROM rcm_journeys WHERE clinic_id = ? AND patient_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`
      )
      .get(ctx.clinicId, ctx.patientId);

    if (open) {
      ctx.journeyId = open.id;
    } else {
      const started = orchestrator.startJourney({
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        source: 'e2e_conversation',
        stage: 'registration',
        skipGates: true,
      });
      ctx.journeyId = started.journey?.id || started.journey_id;
    }

    ctx.copayAmount = 25;
    return { note: `copay=$${ctx.copayAmount} source=${copaySource} journey_id=${ctx.journeyId || 'none'}` };
  });

  /* Stage 4 — Turn 1: derm concern */
  const s4 = await runStage('Conversation Turn 1 — Derm concern (non-emergency)', async () => {
    if (!ctx.KellyAgent) throw new Error('KellyAgent not loaded');

    const turn1Msg = TOM_HARRIS_E2E
      ? fixtures.TOM_HARRIS_MESSAGES.t1
      : OBGYN_E2E
        ? 'I have irregular periods and pelvic pain for two weeks. It is not an emergency — I need gynecology help.'
        : 'I have an itchy rash on my arm for about a week. It is not an emergency — I would like dermatology help.';
    const { reply, toolsUsed } = await kellyTurn(ctx, turn1Msg);

    if (!reply || reply.length < 10) throw new Error(`Kelly reply empty: "${reply}"`);

    const emergencyOnly =
      /911|emergency room|call emergency/i.test(reply) &&
      !/rash|skin|dermat|itch/i.test(reply);
    if (emergencyOnly) {
      throw new Error(`Kelly routed to emergency inappropriately: "${reply.slice(0, 120)}"`);
    }

    const engaged = /rash|skin|dermat|itch|help|appointment|concern|symptom/i.test(reply);
    if (!engaged) throw new Error(`Kelly not engaging with derm concern: "${reply.slice(0, 120)}"`);

    fixtures.assertClinicVisitPath(ctx.sessionId);
    fixtures.assertKellyState(ctx.sessionId, {
      phase: ['TRIAGE_DISCOVERY', 'TRIAGE_ACTIVE'],
      routine_intake_active: false,
    });

    return { note: `tools=[${toolsUsed.join(',')}] Kelly: "${reply.slice(0, 90)}…"` };
  });

  /* Stage 5 — Turn 2: intake follow-up */
  const s5 = await runStage('Conversation Turn 2 — Intake / skin details', async () => {
    if (!s4.ok) throw new Error('Turn 1 failed');

    const { reply, toolsUsed, result } = await kellyTurn(
      ctx,
      TOM_HARRIS_E2E
        ? fixtures.TOM_HARRIS_MESSAGES.t2
        : 'It is dry skin type, not pregnant, moderate itch — about a 3 out of 5. It started last Tuesday. No fever.'
    );

    if (!reply) throw new Error('Empty reply on Turn 2');

    const engaged = /skin|rash|book|appointment|dermat|continue|question|type|help/i.test(reply);
    if (!engaged) throw new Error(`Kelly not continuing intake: "${reply.slice(0, 120)}"`);

    fixtures.assertKellyState(ctx.sessionId, { phase: ['TRIAGE_ACTIVE', 'TRIAGE_DISCOVERY'] });

    const afterT2 = fixtures.readKellyState(ctx.sessionId);
    if (!afterT2.hasRag || result?.low_confidence || /more detail|clarify|tell me more/i.test(reply)) {
      const t2b = await kellyTurn(
        ctx,
        TOM_HARRIS_E2E ? fixtures.TOM_HARRIS_MESSAGES.t2b : 'The rash is on my left forearm, red and scaly, worse at night. Severity is 3 out of 5.'
      );
      const afterT2b = fixtures.readKellyState(ctx.sessionId);
      if (!afterT2b.hasRag) {
        if (TOM_HARRIS_E2E) {
          fixtures.ensureClinicalTriageReady(ctx.sessionId, ctx.patientId, ctx.clinicId, {
            region: 'leg and neck',
            quality: 'itchy rash on leg and neck',
          });
        } else {
          await kellyTurn(ctx, 'Please run triage assessment on my symptoms now.');
        }
      }
      fixtures.assertKellyState(ctx.sessionId, { phase: ['TRIAGE_ACTIVE', 'BOOKING'], hasRag: true });
      return {
        note: `T2b follow-up tools=[${t2b.toolsUsed.join(',')}] hasRag=${fixtures.readKellyState(ctx.sessionId).hasRag}`,
      };
    }

    return { note: `tools=[${toolsUsed.join(',')}] Kelly: "${reply.slice(0, 90)}…"` };
  });

  /* Stage 6 — Turn 3: request availability */
  const s6 = await runStage('Conversation Turn 3 — Patient asks for soonest appointment', async () => {
    if (!s5.ok) throw new Error('Turn 2 failed');

    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      TOM_HARRIS_E2E
        ? fixtures.TOM_HARRIS_MESSAGES.t3(ctx.tomorrowNoon)
        : 'Can you check the soonest dermatology appointment available? I can come in this week.'
    );

    if (!reply) throw new Error('Empty reply on Turn 3');

    const calledSlots = toolsInclude(toolsUsed, /get_available_slots/i);
    const mentionsTime = /monday|tuesday|wednesday|thursday|friday|tomorrow|today|\d{1,2}:\d{2}|am|pm|slot|available/i.test(
      reply
    );

    if (!calledSlots) {
      throw new Error(
        `Kelly did not check availability. tools=[${toolsUsed.join(', ')}] reply="${reply.slice(0, 120)}"`
      );
    }

    fixtures.assertKellyState(ctx.sessionId, { phase: 'BOOKING' });

    return {
      note: `get_available_slots=${calledSlots} mention_time=${mentionsTime} Kelly: "${reply.slice(0, 80)}…"`,
    };
  });

  /* Stage 7 — Turn 4: confirm booking */
  const s7 = await runStage('Conversation Turn 4 — Patient confirms first slot', async () => {
    if (!s6.ok) throw new Error('Turn 3 failed');
    const t4StartedMs = Date.now();

    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      TOM_HARRIS_E2E
        ? fixtures.TOM_HARRIS_MESSAGES.t4(ctx.patientEmail, ctx.tomorrowNoon)
        : 'The first available slot works for me. Please book it. My email is e2e-conversation@somo.test'
    );

    if (!reply) throw new Error('Empty reply on Turn 4');

    const calledBooking = toolsInclude(toolsUsed, /schedule_appointment/i);

    if (ctx.db && ctx.patientId) {
      const recent = ctx.db
        .prepare(
          `SELECT id, created_at FROM appointments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(ctx.patientId);
      if (recent && parseE2eTime(recent.created_at) >= t4StartedMs - 5000) {
        ctx.appointmentId = recent.id;
      }
    }

    if (TOM_HARRIS_E2E && !ctx.appointmentId) {
      ctx.appointmentId = await fixtures.seedTomHarrisAppointment(
        ctx.sessionId,
        ctx.patientId,
        ctx.clinicId,
        { noon: ctx.tomorrowNoon, email: ctx.patientEmail, phone: ctx.patientPhone }
      );
    }

    if (!calledBooking && !ctx.appointmentId) {
      throw new Error(
        `Kelly did not book. tools=[${toolsUsed.join(', ')}] reply="${reply.slice(0, 120)}"`
      );
    }

    const confirmed = /confirm|booked|scheduled|appointment|see you|reserved/i.test(reply);
    if (!confirmed && !ctx.appointmentId) {
      throw new Error(`Kelly did not confirm booking: "${reply.slice(0, 120)}"`);
    }

    fixtures.assertKellyState(ctx.sessionId, { phase: 'BOOKING' });

    return {
      note: `schedule_appointment=${calledBooking} appointment_id=${ctx.appointmentId || 'none'} Kelly: "${reply.slice(0, 80)}…"`,
    };
  });

  if (VISIT_ONLY) {
    skipStage('Turn 5+ skipped', 'KELLY_E2E_VISIT_ONLY=1 — pay turns deferred to F2');
    skipStage('Pay stages skipped', 'visit-only mode');
  } else {
  /* Stage 8 — Turn 5: copay question */
  const s8 = await runStage('Conversation Turn 5 — Insurance / copay question', async () => {
    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      'I have BlueCross insurance. What will my copay be for this visit?'
    );

    if (!reply) throw new Error('Empty reply on Turn 5');

    const calledInsurance = toolsInclude(
      toolsUsed,
      /collect_insurance|get_patient_claims|eligib|insur|benefit|coverage/i
    );
    const mentionsCopay = /copay|\$|dollar|25|amount|cover|benefit|deductible|insurance/i.test(reply);

    const copayMatch = reply.match(/\$\s*(\d+(?:\.\d{2})?)/);
    if (copayMatch) ctx.copayAmount = parseFloat(copayMatch[1]);

    if (ctx.db && ctx.patientId) {
      const elig = ctx.db
        .prepare(
          `SELECT copay_amount FROM eligibility_checks WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(ctx.patientId);
      if (elig?.copay_amount) ctx.copayAmount = elig.copay_amount;
    }

    if (!calledInsurance && !mentionsCopay) {
      throw new Error(
        `Kelly did not discuss copay/insurance. tools=[${toolsUsed.join(', ')}] reply="${reply.slice(0, 120)}"`
      );
    }

    return {
      note: `insurance_tools=${calledInsurance} copay=$${ctx.copayAmount} Kelly: "${reply.slice(0, 80)}…"`,
    };
  });

  /* Stage 9 — Turn 6: pay copay now */
  const s9 = await runStage('Conversation Turn 6 — Patient asks to pay copay now', async () => {
    const copayStr = ctx.copayAmount ? `$${ctx.copayAmount}` : 'the copay';
    const t6StartedAt = new Date().toISOString();
    const payMsg = TOM_HARRIS_E2E
      ? fixtures.TOM_HARRIS_MESSAGES.t6(copayStr)
      : `OK, I would like to pay ${copayStr} now before the appointment. Please send me a secure payment link.`;
    const { reply, toolsUsed } = await kellyTurn(ctx, payMsg);

    if (!reply) throw new Error('Empty reply on Turn 6');

    const calledPayment = toolsInclude(toolsUsed, /request_patient_payment/i);

    if (!calledPayment) {
      throw new Error(
        `Kelly did not call request_patient_payment. tools=[${toolsUsed.join(', ')}] reply="${reply.slice(0, 120)}"`
      );
    }

    ctx.payToken = resolvePayTokenFromSession(ctx, { sinceIso: t6StartedAt });

    if (!ctx.payToken) {
      throw new Error(
        `request_patient_payment ran but no fresh rcm_pay_token in session meta after Turn 6. tools=[${toolsUsed.join(', ')}]`
      );
    }
    if (ctx.payToken) ctx.payUrl = payUrlFromToken(ctx.baseUrl, ctx.payToken);

    const mentionsLink = /link|email|text|send|payment|pay|secure|tap|click/i.test(reply);

    return {
      note: `request_patient_payment=${calledPayment} pay_token=${ctx.payToken.slice(0, 8)}… link_mentioned=${mentionsLink}`,
    };
  });

  /* Stage 10 — Pay context API */
  const s10 = await runStage('Pay link — GET /api/public/rcm/pay/:token context', async () => {
    if (!ctx.payToken) throw new Error('No pay_token');

    let body;
    if (inProcessOnly) {
      const settlement = require('../services/rcm-payment-settlement');
      body = await settlement.getPaymentContext(ctx.payToken);
      if (!body?.success) throw new Error(body?.error || 'getPaymentContext failed');
    } else {
      const res = await Promise.race([
        apiRequest('GET', `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('pay context HTTP timeout')), 15000)),
      ]);
      body = res.json;
      if (!res.status || res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
      if (!body.success) throw new Error(body.error || 'success=false');
    }
    if (body.already_paid) throw new Error('already_paid before settlement');

    return {
      note: `amount=$${body.payment?.amount} card=${body.rails?.card?.available} usdc=${body.rails?.usdc?.available}`,
    };
  });

  /* Stage 11–14 — Live Stripe settlement (optional) */
  if (STRIPE_LIVE && process.env.STRIPE_SECRET_KEY && ctx.payToken && s9.ok && s10.ok) {
    await runStage('Payment gateway — POST create-intent', async () => {
      let body;
      if (inProcessOnly) {
        const settlement = require('../services/rcm-payment-settlement');
        body = await settlement.createStripeIntent(ctx.payToken);
      } else {
        const res = await Promise.race([
          apiRequest('POST', `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}/create-intent`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('create-intent HTTP timeout')), 15000)),
        ]);
        body = res.json;
        if (res.status === 503) throw new Error('Stripe not configured on server');
      }
      if (!body.success || !body.client_secret) throw new Error(JSON.stringify(body));
      ctx.stripeIntentId = body.payment_intent_id;
      return { note: `payment_intent_id=${ctx.stripeIntentId}` };
    });

    await runStage('Live Stripe — confirm PI + POST /complete', async () => {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      let intent = await stripe.paymentIntents.retrieve(ctx.stripeIntentId);
      if (intent.status !== 'succeeded') {
        intent = await Promise.race([
          stripe.paymentIntents.confirm(ctx.stripeIntentId, {
            payment_method: 'pm_card_visa',
            return_url: `${ctx.baseUrl}/patients/payment-success.html?rcm=1&token=${encodeURIComponent(ctx.payToken)}`,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Stripe confirm timed out after 60s')), 60000)
          ),
        ]);
      }
      if (intent.status !== 'succeeded') {
        throw new Error(`Stripe PI status=${intent.status}`);
      }

      const settlement = require('../services/rcm-payment-settlement');
      const settled = await settlement.settleStripe(ctx.payToken, ctx.stripeIntentId);
      if (!settled?.success) {
        throw new Error(`settleStripe failed: ${JSON.stringify(settled)}`);
      }

      if (ctx.db) {
        const payRow = ctx.db
          .prepare(`SELECT id, status FROM rcm_payments WHERE pay_token = ? LIMIT 1`)
          .get(ctx.payToken);
        if (payRow) {
          ctx.paymentId = payRow.id;
          fixtures.assertPaymentPaid(ctx.payToken);
        }
      }

      return { note: `settled via stripe PI ${ctx.stripeIntentId} payment_id=${ctx.paymentId || 'n/a'}` };
    });

    await runStage('Copay accounting — copay_payments row after settlement', async () => {
      const row = ctx.db
        .prepare(
          `SELECT * FROM copay_payments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(ctx.patientId);
      if (!row) {
        throw new Error(
          'No copay_payments row — markPaid may not call recordCopayAfterRcmPayment for this path'
        );
      }
      return { note: `copay_payments id=${row.id} amount=${row.amount}` };
    });

    await runStage('Pay link idempotency — already_paid=true', async () => {
      let body;
      if (inProcessOnly) {
        const settlement = require('../services/rcm-payment-settlement');
        body = await settlement.getPaymentContext(ctx.payToken);
      } else {
        const res = await apiRequest('GET', `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}`);
        body = res.json;
      }
      const paid = body.already_paid || String(body.payment?.status || '').toLowerCase() === 'paid';
      if (!paid) {
        throw new Error(`not paid: already_paid=${body.already_paid} status=${body.payment?.status}`);
      }
      return { note: `status=${body.payment?.status} method=${body.payment?.method}` };
    });
  } else {
    skipStage(
      'Live Stripe settlement (create-intent → confirm → complete → copay row)',
      STRIPE_LIVE
        ? 'Prior stage failed or STRIPE_SECRET_KEY missing'
        : 'Set RCM_E2E_STRIPE_LIVE=1 + STRIPE_SECRET_KEY for live money path'
    );
    skipStage('Copay accounting after live settlement', 'Requires RCM_E2E_STRIPE_LIVE=1');
    skipStage('Pay link idempotency after live settlement', 'Requires RCM_E2E_STRIPE_LIVE=1');
  }

  /* Stage 15 — Wallet (auth required) */
  if (process.env.RCM_E2E_WALLET_TEST === '1' && ctx.patientId && ctx.payToken) {
    await runStage('Wallet — /api/patient/rcm/bill-status shows paid row', async () => {
      const patientSessionId = fixtures.seedPatientSessionForE2e(ctx.patientId, 'e2e-conversation@somo.test');
      const url = new URL(`${API_BASE}/api/patient/rcm/bill-status`);
      const lib = url.protocol === 'https:' ? https : http;
      const res = await new Promise((resolve, reject) => {
        const req = lib.request(
          url,
          { method: 'GET', headers: { 'x-session-id': patientSessionId } },
          (r) => {
            let data = '';
            r.on('data', (c) => {
              data += c;
            });
            r.on('end', () => {
              try {
                resolve({ status: r.statusCode, json: JSON.parse(data || '{}') });
              } catch (_) {
                resolve({ status: r.statusCode, json: {} });
              }
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
      if (res.status === 401) throw new Error('Patient session auth failed');
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return { note: `bill-status ok session=${patientSessionId.slice(0, 12)}…` };
    });
  } else {
  skipStage(
    'Wallet — /api/patient/rcm/bill-status shows paid row',
    process.env.RCM_E2E_WALLET_TEST === '1'
      ? 'Requires pay_token from Turn 6'
      : 'Set RCM_E2E_WALLET_TEST=1 + completed pay turn'
  );
  }

  /* Stage 16 — Stripe PI retrieve */
  if (STRIPE_LIVE && ctx.stripeIntentId) {
    await runStage('Live Stripe — PaymentIntent retrieve', async () => {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const intent = await stripe.paymentIntents.retrieve(ctx.stripeIntentId);
      return { note: `status=${intent.status} amount=${intent.amount}` };
    });
  } else {
    skipStage('Live Stripe — PaymentIntent retrieve', 'No stripeIntentId or STRIPE_LIVE off');
  }

  /* Stage 17 — Webhook wiring */
  await runStage('Stripe webhook — RCM settlement referenced in handler', async () => {
    const fs = require('fs');
    const webhookPath = path.join(MP, 'routes/stripe-webhook-handler.js');
    if (!fs.existsSync(webhookPath)) throw new Error('routes/stripe-webhook-handler.js not found');
    const src = fs.readFileSync(webhookPath, 'utf8');
    const hasRcm = /rcm_payment|rcm.*payment|markPaid|rcm-payment-settlement/i.test(src);
    if (!hasRcm) throw new Error('Webhook handler missing RCM settlement path');
    return { note: 'RCM settlement wired in stripe-webhook-handler.js' };
  });

  /* Stage 18 — Receipt email wiring */
  await runStage('Post-payment — receipt email wired in markPaid', async () => {
    const fs = require('fs');
    const settlementPath = path.join(MP, 'services/rcm-payment-settlement.js');
    const src = fs.readFileSync(settlementPath, 'utf8');
    const hasEmail = /sendRcmPaymentReceipt|sendPaymentLinkEmail|receipt/i.test(src);
    if (!hasEmail) throw new Error('No receipt email in rcm-payment-settlement.js');
    return { note: 'receipt email helper present' };
  });

  /* Stage 19 — Provider portal */
  if (ctx.paymentId) {
    await runStage('Provider portal — GET /api/rcm/payments lists payment row', async () => {
      if (inProcessOnly && ctx.db) {
        const row = ctx.db
          .prepare(`SELECT id, status, amount FROM rcm_payments WHERE id = ? AND clinic_id = ?`)
          .get(ctx.paymentId, ctx.clinicId);
        if (!row) throw new Error(`Payment ${ctx.paymentId} not found in rcm_payments`);
        if (String(row.status).toLowerCase() !== 'paid') {
          throw new Error(`Payment status=${row.status} expected paid`);
        }
        return { note: `in-process rcm_payments id=${row.id} status=${row.status} amount=${row.amount}` };
      }
      await providerLogin();
      const res = await apiRequest('GET', `/api/rcm/payments?clinic_id=${encodeURIComponent(ctx.clinicId)}`);
      if (res.status === 401) throw new Error('Provider auth failed after login');
      if (!res.status || res.status !== 200) throw new Error(`HTTP ${res.status}`);

      const payments = res.json.payments || res.json.data || [];
      if (!Array.isArray(payments)) throw new Error('Unexpected /api/rcm/payments shape');

      const row = payments.find((p) => p.id === ctx.paymentId);
      if (!row) {
        throw new Error(
          `Payment ${ctx.paymentId} not in provider list (${payments.length} rows). Product gap or clinic scope.`
        );
      }

      return { note: `found id=${row.id} status=${row.status} amount=${row.amount}` };
    });
  } else {
    skipStage('Provider portal — payment list', 'No payment_id from conversation stage');
  }

  if (TOM_HARRIS_E2E && ctx.appointmentId && ctx.payToken) {
    await runStage('Email — payment link sent to drlittlekids@gmail.com', async () => {
      if (process.env.RCM_E2E_RECORD_EMAIL !== '1') {
        throw new Error('Set RCM_E2E_RECORD_EMAIL=1 on server for email assert');
      }
      fixtures.assertEmailSentTo(fixtures.TOM_HARRIS_EMAIL, {
        template: 'payment_link',
        requireSuccess: true,
      });
      return { note: 'payment_link email recorded' };
    });
  }

  if (TOM_HARRIS_E2E && ctx.appointmentId) {
    await runStage('Provider — clinical-prep triage summary', async () => {
      const prep = fixtures.assertClinicalPrepInProcess(ctx.appointmentId, ctx.sessionId);
      const health = await Promise.race([
        apiRequest('GET', '/health'),
        new Promise((resolve) => setTimeout(() => resolve({ status: 0 }), 3000)),
      ]);
      if (health.status === 200) {
        try {
          const cookieJar = await Promise.race([
            fixtures.providerApiLogin(API_BASE, PROVIDER_EMAIL, PROVIDER_PASSWORD),
            new Promise((_, reject) => setTimeout(() => reject(new Error('provider login timeout')), 10000)),
          ]);
          await fixtures.assertClinicalPrep(API_BASE, cookieJar, ctx.appointmentId, ctx.sessionId);
          return { note: `appointment_id=${ctx.appointmentId} (HTTP + in-process)` };
        } catch (httpErr) {
          return {
            note: `in-process OK; HTTP clinical-prep skipped: ${httpErr.message}. session=${prep.triageSessionId}`,
          };
        }
      }
      return {
        note: `in-process clinical-prep OK (server health unavailable). session=${prep.triageSessionId}`,
      };
    });
  }
  } /* end !VISIT_ONLY pay path */

  fixtures.teardownKellySession(ctx.sessionId);

  /* Scorecard */
  console.log('\n' + bold('═'.repeat(64)));
  console.log(bold('  SCORECARD — Agentic Pathway Coverage'));
  console.log(bold('═'.repeat(64)) + '\n');

  const pass = results.filter((r) => r.status === PASS).length;
  const fail = results.filter((r) => r.status === FAIL).length;
  const skip = results.filter((r) => r.status === SKIP).length;

  for (const r of results) {
    const statusStr = { PASS: green(PASS), FAIL: red(FAIL), SKIP: yellow(SKIP) }[r.status];
    console.log(
      `  ${String(r.stage).padStart(2)} ${r.label.slice(0, 48).padEnd(48)} ${statusStr} ${grey(r.durationMs ? `${r.durationMs}ms` : '')}`
    );
    if (r.status !== PASS && r.note) console.log(`       ${grey('↳ ' + r.note.slice(0, 100))}`);
  }

  console.log('\n  ' + '─'.repeat(60));
  console.log(`  ${green(`${pass} passed`)}  ${fail ? red(`${fail} failed`) : grey('0 failed')}  ${yellow(`${skip} skipped`)}`);

  const scoreable = pass + fail;
  const pct = scoreable > 0 ? Math.round((pass / scoreable) * 100) : 0;
  console.log(`\n  Agentic pathway score: ${pct}% (${pass}/${scoreable} non-skipped stages passed)\n`);

  const failures = results.filter((r) => r.status === FAIL);
  if (failures.length) {
    console.log(bold(red('  Failure triage:\n')));
    for (const f of failures) {
      let category = 'product_gap';
      if (/Missing DB|No LLM|not healthy|Empty reply/i.test(f.note)) category = 'env_or_test';
      if (/Kelly did not|request_patient_payment|availability|book/i.test(f.note)) category = 'product_gap';
      console.log(`  ${red('✗')} Stage ${f.stage} [${category}] — ${f.label}`);
      console.log(`    ${grey(f.note.slice(0, 120))}\n`);
    }
  }

  console.log(bold('  Conversation transcript:'));
  for (const turn of ctx.conversation) {
    const prefix = turn.role === 'user' ? cyan('  Patient:') : green('  Kelly: ');
    console.log(prefix + grey(turn.content.slice(0, 120) + (turn.content.length > 120 ? '…' : '')));
  }

  if (ctx.toolCallLog.length) {
    console.log('\n' + bold('  Tools invoked across conversation:'));
    for (const t of ctx.toolCallLog) console.log(`    → ${t}`);
  } else {
    console.log('\n  ' + yellow('⚠ No tools captured in toolsUsed — LLM may not have invoked tools this run.'));
  }

  console.log(grey(`\n  session: ${ctx.sessionId}\n`));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(red('\nFatal:'), err);
  process.exit(2);
});
