#!/usr/bin/env node
'use strict';

/**
 * e2e-kelly-rcm-pay-conversation.cjs
 *
 * AGENTIC PATHWAY E2E — Full patient journey diagnostic (derm/booking scenario).
 *
 * Drives conversation turns through KellyAgentService.processTurn (real LLM).
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
const PROVIDER_EMAIL = process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@doclittle.com';
const PROVIDER_PASSWORD = process.env.RCM_E2E_PROVIDER_PASSWORD || 'demo123';
const STRIPE_LIVE = process.env.RCM_E2E_STRIPE_LIVE === '1';
const VISIT_ONLY = process.env.KELLY_E2E_VISIT_ONLY === '1';
const PATIENT_PHONE = process.env.TEST_PATIENT_PHONE || '+15550009991';

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
  const result = await ctx.KellyAgent.processTurn({
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

function resolvePayTokenFromSession(ctx) {
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  const fromMeta = KellyToolExecutor._getSessionMeta(ctx.sessionId, 'rcm_pay_token');
  if (fromMeta) return String(fromMeta);
  return null;
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

  if (!process.env.RCM_E2E_USE_EXISTING_SERVER) {
    console.error(red('Set RCM_E2E_USE_EXISTING_SERVER=1 and start middleware on :4000'));
    process.exit(1);
  }

  const health = await apiRequest('GET', '/health');
  if (health.status !== 200) {
    console.error(red(`Middleware not healthy at ${API_BASE}`));
    process.exit(1);
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
    stripeIntentId: null,
    conversation: [],
    toolCallLog: [],
    KellyAgent: null,
    db: null,
    baseUrl: API_BASE,
  };

  /* Stage 1 — Bootstrap */
  await runStage('Bootstrap — load KellyAgentService + DB tables', async () => {
    if (!hasLlmKey()) {
      throw new Error('No LLM key. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY.');
    }

    const Database = require('better-sqlite3');
    ctx.db = new Database(process.env.DB_PATH, { readonly: false });

    const tables = ctx.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);

    const required = ['fhir_patients', 'appointments', 'eligibility_checks', 'rcm_payments', 'rcm_journeys'];
    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length) throw new Error(`Missing DB tables: ${missing.join(', ')}`);

    const orchestrator = require('../services/rcm-journey-orchestrator');
    orchestrator.ensureKellyRcmTables();

    ctx.KellyAgent = require('../services/kelly-agent-service');

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

    const dbModule = require('../database');
    let patient = dbModule.getFHIRPatientByPhone?.(ctx.patientPhone);

    if (!patient) {
      const resourceId = `Patient/e2e-${crypto.randomBytes(6).toString('hex')}`;
      const resource = {
        resourceType: 'Patient',
        id: resourceId,
        name: [{ given: ['E2E'], family: 'TestPatient' }],
        telecom: [
          { system: 'phone', value: ctx.patientPhone },
          { system: 'email', value: 'e2e-conversation@somo.test' },
        ],
        birthDate: '1990-01-15',
      };
      dbModule.createFHIRPatient(resource);
      patient = dbModule.getFHIRPatient(resourceId);
    }

    if (!patient?.resource_id) throw new Error(`Could not seed patient for phone ${ctx.patientPhone}`);
    ctx.patientId = patient.resource_id;

    return { note: `patient_id=${ctx.patientId}` };
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

    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      'I have an itchy rash on my arm for about a week. It is not an emergency — I would like dermatology help.'
    );

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
      'It is dry skin type, not pregnant, moderate itch — about a 3 out of 5. It started last Tuesday. No fever.'
    );

    if (!reply) throw new Error('Empty reply on Turn 2');

    const engaged = /skin|rash|book|appointment|dermat|continue|question|type|help/i.test(reply);
    if (!engaged) throw new Error(`Kelly not continuing intake: "${reply.slice(0, 120)}"`);

    fixtures.assertKellyState(ctx.sessionId, { phase: 'TRIAGE_ACTIVE' });

    if (result?.low_confidence || /more detail|clarify|tell me more/i.test(reply)) {
      const t2b = await kellyTurn(
        ctx,
        'The rash is on my left forearm, red and scaly, worse at night. Severity is 3 out of 5.'
      );
      fixtures.assertKellyState(ctx.sessionId, { phase: ['TRIAGE_ACTIVE', 'BOOKING'], hasRag: true });
      return {
        note: `T2b low-confidence follow-up tools=[${t2b.toolsUsed.join(',')}]`,
      };
    }

    return { note: `tools=[${toolsUsed.join(',')}] Kelly: "${reply.slice(0, 90)}…"` };
  });

  /* Stage 6 — Turn 3: request availability */
  const s6 = await runStage('Conversation Turn 3 — Patient asks for soonest appointment', async () => {
    if (!s5.ok) throw new Error('Turn 2 failed');

    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      'Can you check the soonest dermatology appointment available? I can come in this week.'
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

    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      'The first available slot works for me. Please book it. My email is e2e-conversation@somo.test'
    );

    if (!reply) throw new Error('Empty reply on Turn 4');

    const calledBooking = toolsInclude(toolsUsed, /schedule_appointment/i);

    if (ctx.db && ctx.patientId) {
      const recent = ctx.db
        .prepare(
          `SELECT id FROM appointments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(ctx.patientId);
      if (recent) ctx.appointmentId = recent.id;
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
    const { reply, toolsUsed } = await kellyTurn(
      ctx,
      `OK, I would like to pay ${copayStr} now before the appointment. Please send me a secure payment link.`
    );

    if (!reply) throw new Error('Empty reply on Turn 6');

    const calledPayment = toolsInclude(toolsUsed, /request_patient_payment/i);

    ctx.payToken = resolvePayTokenFromSession(ctx);
    const pmnt = resolveLatestPayment(ctx);
    if (pmnt) {
      ctx.paymentId = pmnt.id;
      ctx.payToken = ctx.payToken || pmnt.pay_token;
      if (pmnt.journey_id) ctx.journeyId = pmnt.journey_id;
    }
    if (ctx.payToken) ctx.payUrl = payUrlFromToken(ctx.baseUrl, ctx.payToken);

    const mentionsLink = /link|email|text|send|payment|pay|secure|tap|click/i.test(reply);

    if (!calledPayment && !ctx.payToken) {
      throw new Error(
        `Kelly did not call request_patient_payment. tools=[${toolsUsed.join(', ')}] reply="${reply.slice(0, 120)}"`
      );
    }

    if (!ctx.payToken) {
      throw new Error(
        `request_patient_payment expected but no pay_token in session meta or rcm_payments. tools=[${toolsUsed.join(', ')}]`
      );
    }

    return {
      note: `request_patient_payment=${calledPayment} pay_token=${ctx.payToken.slice(0, 8)}… link_mentioned=${mentionsLink}`,
    };
  });

  /* Stage 10 — Pay context API */
  const s10 = await runStage('Pay link — GET /api/public/rcm/pay/:token context', async () => {
    if (!ctx.payToken) throw new Error('No pay_token');

    const res = await apiRequest('GET', `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}`);
    const body = res.json;

    if (!res.status || res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
    if (!body.success) throw new Error(body.error || 'success=false');
    if (body.already_paid) throw new Error('already_paid before settlement');

    return {
      note: `amount=$${body.payment?.amount} card=${body.rails?.card?.available} usdc=${body.rails?.usdc?.available}`,
    };
  });

  /* Stage 11–14 — Live Stripe settlement (optional) */
  if (STRIPE_LIVE && process.env.STRIPE_SECRET_KEY && ctx.payToken && s9.ok && s10.ok) {
    await runStage('Payment gateway — POST create-intent', async () => {
      const res = await apiRequest(
        'POST',
        `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}/create-intent`
      );
      const body = res.json;
      if (res.status === 503) throw new Error('Stripe not configured on server');
      if (!body.success || !body.client_secret) throw new Error(JSON.stringify(body));
      ctx.stripeIntentId = body.payment_intent_id;
      return { note: `payment_intent_id=${ctx.stripeIntentId}` };
    });

    await runStage('Live Stripe — confirm PI + POST /complete', async () => {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const confirmed = await stripe.paymentIntents.confirm(ctx.stripeIntentId, {
        payment_method: 'pm_card_visa',
        return_url: `${ctx.baseUrl}/patients/payment-success.html?rcm=1&token=${encodeURIComponent(ctx.payToken)}`,
      });
      if (confirmed.status !== 'succeeded') {
        throw new Error(`Stripe PI status=${confirmed.status}`);
      }

      const complete = await apiRequest(
        'POST',
        `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}/complete`,
        { method: 'stripe', payment_intent_id: ctx.stripeIntentId }
      );
      if (complete.status !== 200 || !complete.json.success) {
        throw new Error(`complete failed: ${JSON.stringify(complete.json)}`);
      }

      return { note: `settled via stripe PI ${ctx.stripeIntentId}` };
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
      const res = await apiRequest('GET', `/api/public/rcm/pay/${encodeURIComponent(ctx.payToken)}`);
      const body = res.json;
      if (!body.already_paid) {
        throw new Error(`already_paid=false status=${body.payment?.status}`);
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
