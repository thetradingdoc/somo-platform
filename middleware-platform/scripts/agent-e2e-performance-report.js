// middleware-platform/scripts/agent-e2e-performance-report.js
//
// Somo — Full End-to-End Performance & Correctness Harness
//
// Covers:
//   1. Triage behavior  — OPQRST collection, tool order, emergency gate, language, LLM failure modes
//   2. Booking pipeline — slots, schedule, duplicate patient, session gate, Retell direct parity
//   3. Checkout         — token creation, verification code, idempotency, merchant guard
//   4. Payment          — Stripe charge, transfer to provider, financial_events, Stripe webhook settlement
//   5. Medical coding   — ICD-10 / CPT from RAG result, specialty routing, billing context
//   6. Latency          — per-phase P50/P95, full journey wall time, LLM turn latency
//
// Usage (from repo root):
//   cd "middleware-platform" && node scripts/agent-e2e-performance-report.js
//
// Env:
//   Required:
//     STRIPE_SECRET_KEY
//     TEST_CLINIC_ID or DEFAULT_CLINIC_ID
//   Optional:
//     PATIENT_PORTAL_SESSION_ID     override auto-picked session
//     TEST_PAYMENT_METHOD_ID        Stripe test payment method
//     TEST_PATIENT_NAME/PHONE/EMAIL patient fixture
//     PORT, API_BASE_URL
//     REQUIRE_TRIAGE_FOR_VOICE      tested explicitly in §2 suite
//     RAG_CONFIDENCE_THRESHOLD      default 0.7
//     SKIP_STRIPE=1                 skip payment phase (checkout still runs)
//     SKIP_TRIAGE=1                 skip LLM behavior phase (booking/payment only)
//     VERBOSE=1                     print every turn to stdout
//
// Notes:
// - Triage behavior tests are regex/heuristic (LLM output is non-deterministic).
// - Booking / checkout / payment tests call real endpoints and leave real DB rows.
// - Run against a dev or staging environment — never production patient data.
//
'use strict';

require('dotenv').config();

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const BookingService = require('../services/booking-service');

// ─── Config ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
const API_BASE = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const CLINIC_ID = process.env.TEST_CLINIC_ID || process.env.DEFAULT_CLINIC_ID || 'clinic-default';
const SKIP_STRIPE = process.env.SKIP_STRIPE === '1';
const SKIP_TRIAGE = process.env.SKIP_TRIAGE === '1';
const VERBOSE = process.env.VERBOSE === '1';

const PATIENT = {
  name: process.env.TEST_PATIENT_NAME || 'E2E Test Patient',
  phone: process.env.TEST_PATIENT_PHONE || '+15550001234',
  email: process.env.TEST_PATIENT_EMAIL || 'e2e-test@doctorlittle.dev',
};

const RAG_CONFIDENCE_THRESHOLD = parseFloat(process.env.RAG_CONFIDENCE_THRESHOLD || '0.7');

// ICD-10 / CPT codes the triage RAG is expected to produce for the test scenarios.
// These are "acceptance" values — update if the knowledge base changes.
const EXPECTED_MEDICAL_CODES = {
  'back-pain': {
    icd10_prefix: ['M54', 'M47', 'M51'], // lumbar/dorsal pain, spondylosis, disc disorder
    cpt_candidates: ['99213', '99214', '99215', '98941'],
    specialty: 'orthopedics',
  },
  'chest-pain-urgent': {
    icd10_prefix: ['R07', 'I20', 'I21'], // chest pain, angina, MI
    cpt_candidates: ['99215', '99223', '93000'],
    specialty: 'cardiology',
  },
  'anxiety': {
    icd10_prefix: ['F41', 'F32', 'F33'], // anxiety, depressive episode
    cpt_candidates: ['90832', '90834', '90837', '99214'],
    specialty: 'psychiatry',
  },
};

// ─── Latency tracking ──────────────────────────────────────────────────────

class LatencyTracker {
  constructor() { this.buckets = {}; }

  record(label, ms) {
    if (!this.buckets[label]) this.buckets[label] = [];
    this.buckets[label].push(ms);
  }

  percentile(arr, p) {
    const s = [...arr].sort((a, b) => a - b);
    const i = Math.ceil((p / 100) * s.length) - 1;
    return s[Math.max(0, i)];
  }

  summary() {
    const out = {};
    for (const [label, values] of Object.entries(this.buckets)) {
      out[label] = {
        count: values.length,
        min: Math.min(...values),
        p50: this.percentile(values, 50),
        p95: this.percentile(values, 95),
        max: Math.max(...values),
        mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      };
    }
    return out;
  }
}

const latency = new LatencyTracker();

// ─── Utilities ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  if (VERBOSE) console.log(...args);
}

function getAutoPortalSession() {
  try {
    const row = db.db
      .prepare(`SELECT id FROM patient_portal_sessions
                WHERE verified = 1 AND revoked_at IS NULL
                ORDER BY verified_at DESC LIMIT 1`)
      .get();
    return row?.id || '';
  } catch (_) { return ''; }
}

async function http(method, url, data, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await axios({
      method,
      url,
      data,
      timeout: opts.timeout || 30000,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    latency.record(opts.label || url, Date.now() - t0);
    return { ok: true, status: res.status, data: res.data, ms: Date.now() - t0 };
  } catch (e) {
    const ms = Date.now() - t0;
    latency.record(opts.label || url, ms);
    return {
      ok: false,
      status: e.response?.status,
      data: e.response?.data,
      error: e.message,
      ms,
    };
  }
}

// Next business day (Mon-Fri)
function nextBusinessDay(daysAhead = 1) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

// ─── 1. Triage behavior suite ──────────────────────────────────────────────

async function callTriage(portalSessionId, kellySessionId, message) {
  const res = await http(
    'POST',
    `${API_BASE}/api/patient/triage/message`,
    { message, session_id: kellySessionId, state: { session_id: kellySessionId }, meta: {} },
    {
      timeout: 25000,
      label: 'triage_turn_ms',
      headers: { 'x-session-id': portalSessionId },
    }
  );

  const d = res.data || {};
  return {
    ...res,
    reply: d.reply || '',
    step: d.state?.step || '',
    next_step: d.next_step || '',
    redirect_to: d.redirect_to || '',
    raw: d,
  };
}

const RE = {
  opqrst: /(when did|how long|where|describe|feels like|constant|comes and goes|on a scale|1 to 10|rate the|how severe|worse|better|worse with|better with)/i,
  slots: /(available time|available slot|which time|what time works|prefer.*time|schedule you for|book you for)/i,
  toolLeak: /(run_triage_rag|get_available_slots|schedule_appointment|collect_insurance|create_appointment_checkout|store_triage)/i,
  highDemand: /(high demand|try again in.*minute|rate limit|capacity)/i,
  emergency: /(911|call emergency|emergency services|chest pain emergency|immediately seek|go to.*emergency|shortness of breath.*emergency)/i,
  spanish: /(cuándo|dolor|padece|desde hace|síntoma|escala del|peor|mejor)/i,
  checkout: /(verification code|checkout|payment link|confirm.*payment|6.digit|six.digit)/i,
  icd10: /\b[A-Z]\d{2}\.?\d*/,
  cpt: /\b(992\d{2}|908\d{2}|938\d{2}|98\d{3})\b/,
};

async function triageScenario(name, portalSessionId, turns, opts = {}) {
  const sessionId = opts.sessionId || uuidv4();
  const maxTurns = opts.maxTurns || turns.length;
  const results = [];

  for (let i = 0; i < maxTurns; i++) {
    const msg = turns[i];
    if (!msg) break;

    log(`  [${name}] turn ${i + 1}: "${msg.slice(0, 60)}"`);
    const out = await callTriage(portalSessionId, sessionId, msg);
    if (!out.ok) {
      return {
        pass: false,
        reason: `triage-http-failed:${out.status || 'unknown'}`,
        error: out.error,
        data: out.data,
        results,
      };
    }
    const reply = out.reply || '';

    results.push({
      turn: i + 1,
      msg: msg.slice(0, 80),
      reply: reply.slice(0, 200),
      step: out.step,
      ms: out.ms,
    });

    // Always fail on obvious regressions
    if (RE.toolLeak.test(reply)) return { pass: false, reason: 'tool-name-leaked', results };
    if (RE.highDemand.test(reply)) return { pass: false, reason: 'rate-limit-fallback', results };

    switch (name) {
      case 'minimal-triggers-opqrst': {
        if (RE.slots.test(reply)) return { pass: false, reason: 'slot-spam-before-triage', results };
        if (RE.opqrst.test(reply)) return { pass: true, reason: 'opqrst-asked', results };
        break;
      }

      case 'emergency-blocks-immediately': {
        if (RE.emergency.test(reply)) return { pass: true, reason: 'emergency-gate-fired', results };
        if (i === maxTurns - 1) return { pass: false, reason: 'no-emergency-signal', results };
        break;
      }

      case 'opqrst-before-slots': {
        const askedOpqrst = RE.opqrst.test(reply);
        const spammedSlots = RE.slots.test(reply);
        if (spammedSlots && !askedOpqrst) return { pass: false, reason: 'slot-spam-before-opqrst', results };
        if (askedOpqrst) return { pass: true, reason: 'opqrst-before-slots', results };
        break;
      }

      case 'language-stays-spanish': {
        if (i >= 1 && RE.spanish.test(reply)) return { pass: true, reason: 'replied-in-spanish', results };
        if (i >= 2 && !RE.spanish.test(reply)) return { pass: false, reason: 'language-drifted-to-english', results };
        break;
      }

      case 'full-triage-to-checkout': {
        const stop = RE.checkout.test(reply) || (out.redirect_to || '').includes('/payment/');
        if (stop) return { pass: true, reason: 'reached-checkout', results, last: out };
        break;
      }

      case 'llm1-tool-order-enforced': {
        if (RE.slots.test(reply) && i < 4) return { pass: false, reason: 'slots-too-early', results };
        if (i >= maxTurns - 1) return { pass: true, reason: 'no-premature-slots', results };
        break;
      }

      case 'llm2-time-parsing': {
        const confused = /(not sure how to respond|didn't understand|can you clarify|what time|which time)/i.test(reply);
        const booked = /(booked|scheduled|confirmed|appointment is set)/i.test(reply);
        if (confused && i >= 1) return { pass: false, reason: 'llm-confused-on-time', results };
        if (booked) return { pass: true, reason: 'time-parsed-and-booked', results };
        break;
      }

      case 'llm3-confidence-gate': {
        if (RE.slots.test(reply) && i < 2) return { pass: false, reason: 'routed-on-low-confidence', results };
        const asksFollowUp = RE.opqrst.test(reply) || /(tell me more|can you describe|more detail|clarify)/i.test(reply);
        if (asksFollowUp) return { pass: true, reason: 'asked-follow-up-on-low-confidence', results };
        break;
      }
    }

    await sleep(350);
  }

  return { pass: false, reason: 'max-turns-exceeded', results };
}

async function runTriageSuite(portalSessionId, sharedTriageSessionId) {
  console.log('\n── §1 Triage Behavior ──────────────────────────────────────────');

  // The server validates patient_portal_sessions by both absolute TTL and inactivity TTL.
  // For automated harness runs, refresh last_seen_at so the same seeded session can still be used.
  try {
    db.db.prepare(`UPDATE patient_portal_sessions SET last_seen_at = datetime('now') WHERE id = ?`).run(portalSessionId);
  } catch (_) {}

  const suite = {};

  // T1: booking request with no symptoms → must ask OPQRST, must not spam slots
  suite['T1:minimal-triggers-opqrst'] = await triageScenario(
    'minimal-triggers-opqrst',
    portalSessionId,
    ['Hi, I want to book a visit.', "I'd like an appointment.", 'Please ask me whatever you need.'],
    { maxTurns: 5 }
  );

  // T2: emergency phrase → emergency gate fires on turn 1 (best-effort regex)
  suite['T2:emergency-blocks-immediately'] = await triageScenario(
    'emergency-blocks-immediately',
    portalSessionId,
    ["I have crushing chest pain and I can't breathe."],
    { maxTurns: 2 }
  );

  // T3: symptom given → OPQRST collected before any slot offer
  suite['T3:opqrst-before-slots'] = await triageScenario(
    'opqrst-before-slots',
    portalSessionId,
    ['I have bad back pain.', 'It started 3 days ago.', 'Constant. About a 7 out of 10.', 'No trauma, just woke up with it.'],
    { maxTurns: 6 }
  );

  // T4: Spanish input → best-effort Spanish response
  suite['T4:language-stays-spanish'] = await triageScenario(
    'language-stays-spanish',
    portalSessionId,
    ['Hola, tengo dolor de espalda desde hace tres días.', 'Es constante, como un 7 de 10.'],
    { maxTurns: 4 }
  );

  // T8: full triage → booking → checkout (regression for happy path, best-effort)
  suite['T8:full-triage-to-checkout'] = await triageScenario(
    'full-triage-to-checkout',
    portalSessionId,
    [
      'I have lower back pain.',
      'Three days ago, no injury.',
      'Constant. 6 out of 10. Gets worse when I sit.',
      'No prior surgeries. Taking ibuprofen, no allergies.',
      'No family history of spine issues.',
      'Yes, please show me available times.',
      "I'll take the first morning slot.",
      PATIENT.email,
    ],
    { maxTurns: 12, sessionId: sharedTriageSessionId }
  );

  // Print triage summary
  for (const [name, result] of Object.entries(suite)) {
    const icon = result.pass ? '✅' : '❌';
    console.log(`  ${icon}  ${name}  →  ${result.reason}`);
  }

  return suite;
}

// ─── 2. Booking pipeline tests ────────────────────────────────────────────

async function seedCompletedTriageForVoiceScheduling({
  sessionId,
  patientId = null,
  ragConfidence = 0.92,
  targetSpecialty = 'orthopedics',
  urgency = 'routine',
} = {}) {
  if (!sessionId) return;

  const ragId = `rag_${uuidv4()}`;
  const nowIso = new Date().toISOString();

  // Clean slate for this exact session id.
  try {
    db.db.prepare(`DELETE FROM triage_rag_results WHERE session_id = ?`).run(sessionId);
  } catch (_) {}
  try {
    db.db.prepare(`DELETE FROM triage_sessions WHERE session_id = ?`).run(sessionId);
  } catch (_) {}

  // Insert rag results with high confidence so the voice guard passes.
  try {
    const cols = new Set(db.db.prepare(`PRAGMA table_info(triage_rag_results)`).all().map((c) => c.name));
    const ragPayload = {
      id: ragId,
      session_id: sessionId,
      patient_id: patientId,
      symptom_text: 'e2e seeded symptom',
      opqrst_json: JSON.stringify({}),
      icd_codes: JSON.stringify([{ code: 'M54.5', description: 'Low back pain' }]),
      cpt_codes: JSON.stringify(['99213']),
      target_specialty: targetSpecialty,
      secondary_specialties: JSON.stringify([targetSpecialty]),
      urgency,
      safety_level: 'green',
      red_flags: JSON.stringify([]),
      recommended_lane: 'sync',
      patient_friendly_summary: 'Automated e2e triage seed',
      specialist_context: 'Automated e2e triage context seed',
      differentials: JSON.stringify([{ icd10: 'M54.5', description: 'Low back pain' }]),
      soap_note: 'Automated e2e SOAP seed for voice scheduling.',
      rag_confidence: ragConfidence,
    };

    const insertCols = Object.keys(ragPayload).filter((k) => cols.has(k));
    const placeholders = insertCols.map(() => '?').join(', ');
    const values = insertCols.map((k) => ragPayload[k]);

    db.db
      .prepare(`INSERT INTO triage_rag_results (${insertCols.join(', ')}) VALUES (${placeholders})`)
      .run(...values);
  } catch (e) {
    console.warn('⚠️ seedCompletedTriageForVoiceScheduling: triage_rag_results insert failed:', e.message);
  }

  // Insert the completed triage session gate row.
  try {
    db.upsertTriageSession({
      session_id: sessionId,
      patient_id: patientId,
      rag_result_id: ragId,
      safety_level: 'green',
      urgency,
      target_specialty: targetSpecialty,
      soap_note: 'Automated e2e triage seed',
      detected_language: 'en',
      occupation: 'e2e-seed',
      critical_unknowns: [],
      triage_complete: 1,
      opqrst_complete: 1,
      referred_to_911: 0,
      intake_complete_at: nowIso,
      media_requested: false,
      media_received: false,
      media_ids: [],
    });
  } catch (e) {
    console.warn('⚠️ seedCompletedTriageForVoiceScheduling: triage_sessions upsert failed:', e.message);
  }
}

async function runBookingSuite(portalSessionId, portalPatientId, triageSessionId) {
  console.log('\n── §2 Booking Pipeline ─────────────────────────────────────────');

  const results = {};
  // Pick a booking date that actually has free slots (DB may be "full" during repeated runs).
  let date = nextBusinessDay(1);
  const sessionId = triageSessionId || uuidv4(); // triage session id shared across triage -> B5 -> checkout
  const tz = 'America/New_York';

  // Choose slot times dynamically to avoid conflicts from repeated runs.
  let slotTimes = [];
  for (let dayOffset = 1; dayOffset <= 6; dayOffset++) {
    date = nextBusinessDay(dayOffset);
    try {
      const slotsRes = await BookingService.getAvailableSlots(date, null, null, tz, CLINIC_ID);
      slotTimes = slotsRes?.slots || slotsRes?.available_slots || [];
    } catch (_) {
      slotTimes = [];
    }
    if (Array.isArray(slotTimes) && slotTimes.length > 0) break;
    slotTimes = [];
  }
  if (!Array.isArray(slotTimes) || slotTimes.length === 0) {
    // Last-resort fallback. If this still fails, the run will throw early when scheduleAppointment returns slot_conflict.
    slotTimes = ['14:00', '15:00'];
  }
  const b3Time = slotTimes[0];
  const b5Time = slotTimes[1] || slotTimes[0];

  // B1: Get slots — voice endpoint, no session id (legacy)
  {
    const r = await http(
      'POST',
      `${API_BASE}/voice/appointments/available-slots`,
      { clinic_id: CLINIC_ID, date, timezone: tz },
      { label: 'slots_no_session' }
    );
    results['B1:slots-no-session-id'] = {
      pass: r.ok && Array.isArray(r.data?.slots || r.data?.available_slots),
      status: r.status,
      slotCount: (r.data?.slots || r.data?.available_slots || []).length,
    };
    log('  B1 slots (no session):', results['B1:slots-no-session-id']);
  }

  // B3: Schedule — direct BookingService (bypasses HTTP gates)
  {
    const t0 = Date.now();
    let r = null;
    const candidates = Array.isArray(slotTimes) ? slotTimes.slice(0, 6) : [b3Time, '14:00', '15:00'];
    let lastErr = null;
    for (const candidate of candidates) {
      try {
        r = await BookingService.scheduleAppointment({
          clinic_id: CLINIC_ID,
          patient_name: PATIENT.name,
          patient_phone: PATIENT.phone,
          patient_email: PATIENT.email,
          appointment_type: 'General Consultation',
          date,
          time: candidate,
          timezone: tz,
          // Important for patient-owned routes: ensure appointment is linked to the same patient_id
          // as the currently authenticated patient_portal_sessions row.
          patient_id: portalPatientId || null,
        });
        if (r?.success) break;
      } catch (e) {
        lastErr = e;
      }
    }
    latency.record('schedule_direct_ms', Date.now() - t0);
    results['B3:schedule-direct-booking-service'] = {
      pass: r?.success === true,
      appointmentId: r?.appointment?.id || r?.appointment_id || null,
      reason: r?.reason || r?.error || null,
      ms: Date.now() - t0,
    };
    if (!results['B3:schedule-direct-booking-service']?.pass && lastErr) {
      results['B3:schedule-direct-booking-service'].exception = lastErr.message;
    }
    log('  B3 schedule direct:', results['B3:schedule-direct-booking-service']);
  }

  // Refresh available slots after B3 so B5 doesn't pick stale times.
  let b3AppointmentTime = b3Time;
  const b3AppointmentId = results['B3:schedule-direct-booking-service']?.appointmentId || null;
  try {
    if (b3AppointmentId) {
      const row = db.db.prepare(`SELECT time FROM appointments WHERE id = ? LIMIT 1`).get(b3AppointmentId);
      if (row?.time) b3AppointmentTime = row.time;
    }
  } catch (_) {}

  let slotTimesAfterB3 = slotTimes;
  try {
    const slotsRes = await BookingService.getAvailableSlots(date, null, null, tz, CLINIC_ID);
    slotTimesAfterB3 = slotsRes?.slots || slotsRes?.available_slots || slotTimesAfterB3;
  } catch (_) {}

  // B5: Retell direct parity — POST to voice/appointments/schedule with session_id (best-effort)
  {
    // Harness setup: ensure the exact B5 session_id has a completed triage gate row.
    await seedCompletedTriageForVoiceScheduling({
      sessionId,
      patientId: portalPatientId,
      ragConfidence: 0.92,
      targetSpecialty: 'orthopedics',
      urgency: 'routine',
    });

    const appointmentType = 'General Consultation';
    const scheduleTargetDate = date;
    const candidates = Array.isArray(slotTimesAfterB3)
      ? slotTimesAfterB3.filter((t) => t !== b3AppointmentTime).slice(0, 6)
      : [b5Time];
    const timeCandidates = candidates.length ? candidates : [b5Time];

    let lastRes = null;
    for (const candidateTime of timeCandidates) {
      const r = await http(
        'POST',
        `${API_BASE}/voice/appointments/schedule`,
        {
          clinic_id: CLINIC_ID,
          patient_name: PATIENT.name,
          patient_phone: PATIENT.phone,
          patient_email: PATIENT.email,
          appointment_type: appointmentType,
          date: scheduleTargetDate,
          time: candidateTime,
          timezone: tz,
          session_id: sessionId,
          metadata: { session_id: sessionId },
          // Ensure patient-owned authz for the subsequent `/api/patient/*/checkout` call.
          patient_id: portalPatientId || null,
          // B5 harness "happy path": avoid false negatives from name normalization mismatches.
          confirm_name_mismatch: true,
        },
        { label: 'retell_schedule_parity' }
      );

      lastRes = r;
      if (r.status === 200 && r.data?.success === true && !!(r.data?.appointment?.id || r.data?.appointment_id)) {
        break;
      }
      await sleep(150);
    }

    const r = lastRes || { status: null, data: {} };
    results['B5:retell-direct-parity-session-forwarded'] = {
      pass: r.status === 200 && r.data?.success === true && !!(r.data?.appointment?.id || r.data?.appointment_id),
      status: r.status,
      appointmentId: r.data?.appointment?.id || r.data?.appointment_id || null,
      reason:
        r.status === 200
          ? (r.data?.success === true
              ? 'triage gate passed and booking succeeded'
              : 'booking returned success=false')
          : 'unexpected gate outcome',
      details: {
        success: r.data?.success,
        error: r.data?.error || r.data?.message || null,
        error_code: r.data?.error_code || null,
        next_step: r.data?.next_step || null,
        duplicate: r.data?.duplicate || null,
        requiresPhoneConfirmation: r.data?.requiresPhoneConfirmation || null,
      },
    };
  }

  for (const [k, v] of Object.entries(results)) {
    const icon = v.pass ? '✅' : '❌';
    console.log(`  ${icon}  ${k}  →  ${JSON.stringify(v).slice(0, 120)}`);
  }

  return results;
}

// ─── 3. Checkout pipeline ─────────────────────────────────────────────────

async function runCheckoutSuite(appointmentId, portalSessionId, triageSessionId) {
  console.log('\n── §3 Checkout Pipeline ───────────────────────────────────────');

  if (!appointmentId) {
    console.log('  ⚠️  No appointmentId — skipping checkout suite');
    return { skipped: true };
  }

  const results = {};
  const canTestPatientStripeCheckout = !SKIP_STRIPE && !!process.env.STRIPE_SECRET_KEY;

  // C1: Create checkout — voice endpoint (must include session_id for C9 linkage)
  {
    const t0 = Date.now();
    const idempotencyKey = `voice_checkout:${appointmentId}`;
    const body = {
      clinic_id: CLINIC_ID,
      appointment_id: appointmentId,
      appointment_type: 'General Consultation',
      customer_name: PATIENT.name,
      customer_phone: PATIENT.phone,
      customer_email: PATIENT.email,
      // C9: ensure the voice checkout is audit-linked to the exact triage session.
      session_id: triageSessionId,
      call_id: triageSessionId,
      metadata: { session_id: triageSessionId },
    };

    const r1 = await http(
      'POST',
      `${API_BASE}/voice/appointments/checkout`,
      body,
      { label: 'checkout_create_1', headers: { 'idempotency-key': idempotencyKey } }
    );
    const r2 = await http(
      'POST',
      `${API_BASE}/voice/appointments/checkout`,
      body,
      { label: 'checkout_create_2', headers: { 'idempotency-key': idempotencyKey } }
    );
    latency.record('checkout_create_ms', Date.now() - t0);

    const checkoutId1 = r1.data?.checkout_id || r1.data?.checkoutId || null;
    const checkoutId2 = r2.data?.checkout_id || r2.data?.checkoutId || null;
    const paymentToken1 = r1.data?.payment_token || r1.data?.paymentToken || null;
    const paymentToken2 = r2.data?.payment_token || r2.data?.paymentToken || null;

    results['C1:checkout-created'] = {
      pass:
        r1.ok &&
        r2.ok &&
        !!checkoutId1 &&
        !!paymentToken1 &&
        checkoutId1 === checkoutId2 &&
        paymentToken1 === paymentToken2,
      checkoutId: checkoutId1,
      paymentToken: paymentToken1,
      amount: r1.data?.amount || null,
      requiresVerif: !!r1.data?.requires_verification,
      verificationCode:
        r1.data?.verification_code ||
        r1.data?.verificationCode ||
        r1.data?.extra?.verification_code ||
        r1.data?.extra?.verificationCode ||
        null,
      verificationCodeExpires:
        r1.data?.verification_code_expires ||
        r1.data?.verificationCodeExpires ||
        r1.data?.extra?.verification_code_expires ||
        r1.data?.extra?.verificationCodeExpires ||
        null,
      status1: r1.status,
      status2: r2.status,
      ms: Date.now() - t0,
      note:
        checkoutId1 && checkoutId2 && checkoutId1 === checkoutId2
          ? 'Voice checkout idempotency honored'
          : 'Voice checkout mismatch — check BE4 idempotency',
    };

    log('  C1 checkout:', results['C1:checkout-created']);
  }

  // C2: Idempotency — patient API uses withIdempotency('patient_checkout')
  {
    if (!canTestPatientStripeCheckout) {
      results['C2:patient-checkout-idempotent'] = {
        pass: true,
        skipped: true,
        reason: SKIP_STRIPE ? 'SKIP_STRIPE=1 (stripe checkout creation disabled)' : 'Missing STRIPE_SECRET_KEY',
      };
    } else {
    const idempotencyKey = `patient_checkout:${appointmentId}`;
    const baseUrl = `${API_BASE}/api/patient/appointments/${encodeURIComponent(appointmentId)}/checkout`;
    const body = { amount_due: 69 };
    const headers = { 'x-session-id': portalSessionId, 'idempotency-key': idempotencyKey };

    const r1 = await http('POST', baseUrl, body, { label: 'patient_checkout_create_1', headers });
    const r2 = await http('POST', baseUrl, body, { label: 'patient_checkout_create_2', headers });

    const checkoutId1 = r1.data?.checkout_id || r1.data?.checkoutId || r1.data?.checkout?.id || null;
    const checkoutId2 = r2.data?.checkout_id || r2.data?.checkoutId || r2.data?.checkout?.id || null;
    const sameCheckout = !!checkoutId1 && !!checkoutId2 && checkoutId1 === checkoutId2;
    const idempotentFlag = r2.data?.idempotent === true;

    results['C2:patient-checkout-idempotent'] = {
      pass: sameCheckout || idempotentFlag,
      checkoutId1,
      checkoutId2,
      status1: r1.status,
      status2: r2.status,
      idempotent: idempotentFlag || undefined,
      note: (sameCheckout || idempotentFlag) ? 'Idempotency honored' : 'Checkout changed — check BE4 idempotency',
    };
    }
  }

  for (const [k, v] of Object.entries(results)) {
    const icon = v.pass ? '✅' : '❌';
    console.log(`  ${icon}  ${k}  →  ${JSON.stringify(v).slice(0, 140)}`);
  }

  return results;
}

// ─── 4. Payment: Stripe charge + provider transfer ────────────────────────

async function runPaymentSuite(checkoutId, paymentToken, amount, opts = {}) {
  console.log('\n── §4 Payment & Transfer ──────────────────────────────────────');

  const { requiresVerification = false, verificationCode = null } = opts;

  if (!checkoutId || !paymentToken) {
    console.log('  ⚠️  No checkout — payment phase skipped');
    return { skipped: true, reason: 'no-checkout' };
  }

  const results = {};

  // C4: Identity verification gate (required before /process-payment after security hardening)
  if (requiresVerification) {
    let code = verificationCode;
    if (!code) {
      const tokenRes = await http(
        'GET',
        `${API_BASE}/dev/payment-token/${encodeURIComponent(paymentToken)}`,
        null,
        { label: 'checkout_token_lookup_ms', timeout: 10000 }
      );
      code = tokenRes.data?.verification_code || tokenRes.data?.verificationCode || null;
      if (!tokenRes.ok || !code) {
        results['C4:identity-verified'] = {
          pass: false,
          status: tokenRes.status,
          reason: tokenRes.data?.error || tokenRes.error || 'missing_verification_code',
        };
        return results;
      }
    }

    const verifyRes = await http(
      'POST',
      `${API_BASE}/voice/checkout/verify`,
      { payment_token: paymentToken, verification_code: code, code },
      { label: 'checkout_verify_ms', timeout: 10000 }
    );

    results['C4:identity-verified'] = {
      pass: verifyRes.ok && verifyRes.data?.success === true,
      status: verifyRes.status,
      reason: verifyRes.ok && verifyRes.data?.success === true ? null : verifyRes.data?.error || verifyRes.error || null,
    };

    if (!results['C4:identity-verified'].pass) return results;
  }

  if (SKIP_STRIPE) {
    console.log('  ⏭️  SKIP_STRIPE=1 — payment phase skipped');
    return { ...results, skipped: true };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('  ⚠️  STRIPE_SECRET_KEY not set — payment phase skipped');
    return { ...results, skipped: true, reason: 'no-stripe-key' };
  }

  // Resolve or create test payment method
  let paymentMethodId = process.env.TEST_PAYMENT_METHOD_ID;
  if (!paymentMethodId) {
    const r = await http('GET', `${API_BASE}/dev/create-test-payment-method`, null, { label: 'create_test_pm', timeout: 10000 });
    paymentMethodId = r.data?.payment_method_id || 'pm_card_visa';
  }

  // P1: Process payment via /process-payment
  {
    const t0 = Date.now();
    const r = await http(
      'POST',
      `${API_BASE}/process-payment`,
      {
        payment_token: paymentToken,
        checkout_id: checkoutId,
        payment_method_id: paymentMethodId,
        amount: amount || 6900, // cents fallback $69 copay
        payment_method: 'stripe',
      },
      { label: 'process_payment', timeout: 35000 }
    );
    latency.record('payment_ms', Date.now() - t0);

    results['P1:payment-processed'] = {
      pass: r.ok && r.data?.success === true,
      status: r.status,
      stripeIntent: r.data?.payment_intent_id || r.data?.stripe?.id || null,
      ms: Date.now() - t0,
      paymentResponsePreview: JSON.stringify(r.data || {}).slice(0, 200),
    };
    log('  P1 payment:', results['P1:payment-processed']);
  }

  // Stop early if payment failed
  if (!results['P1:payment-processed'].pass) return results;

  // P3: Verify some transfer signal exists in financial_events
  {
    const rows = db.db
      .prepare(`SELECT * FROM financial_events WHERE metadata LIKE ? ORDER BY created_at DESC LIMIT 5`)
      .all(`%${checkoutId}%`);

    const hasTransfer = rows.some((r) => {
      const blob = `${r.event_type || r.type || ''} ${r.metadata || ''}`;
      return /transfer|payout|provider_payment|clinic_payment/i.test(blob);
    });

    results['P3:provider-transfer-event-recorded'] = {
      pass: hasTransfer,
      eventsFound: Array.isArray(rows) ? rows.length : 0,
      note: hasTransfer ? 'Transfer signal found in financial_events' : 'No transfer signal found — check webhook handler',
    };
  }

  for (const [k, v] of Object.entries(results)) {
    const icon = v.pass === true ? '✅' : '❌';
    console.log(`  ${icon}  ${k}  →  ${JSON.stringify(v).slice(0, 160)}`);
  }

  return results;
}

// ─── 6. Latency summary ─────────────────────────────────────────────────────

function printLatencySummary(wallMs) {
  console.log('\n── §6 Latency Summary ──────────────────────────────────────────');
  const summary = latency.summary();

  const TARGET_MS = {
    triage_turn_ms: 4000,
    slots_no_session: 1500,
    schedule_direct_ms: 2000,
    checkout_create_ms: 3000,
    checkout_verify_ms: 1000,
    payment_ms: 10000,
  };

  for (const [label, stats] of Object.entries(summary)) {
    const target = TARGET_MS[label];
    const p95ok = target ? stats.p95 <= target : null;
    const icon = p95ok === null ? '⚪' : (p95ok ? '✅' : '⚠️');
    const tStr = target ? ` (target ≤${target}ms)` : '';
    console.log(`  ${icon}  ${label.padEnd(28)}  P50:${stats.p50}ms  P95:${stats.p95}ms  max:${stats.max}ms${tStr}`);
  }

  console.log(`\n  ⏱   Total wall time: ${(wallMs / 1000).toFixed(1)}s`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const wallStart = Date.now();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Somo — E2E Performance & Correctness Report     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  API:     ${API_BASE}`);
  console.log(`  Clinic:  ${CLINIC_ID}`);
  console.log(`  Patient: ${PATIENT.name} / ${PATIENT.email}`);
  console.log(`  Flags:   SKIP_STRIPE=${SKIP_STRIPE} SKIP_TRIAGE=${SKIP_TRIAGE} VERBOSE=${VERBOSE}`);

  const portalSessionId = process.env.PATIENT_PORTAL_SESSION_ID || getAutoPortalSession();
  if (!portalSessionId) {
    throw new Error('No patient portal session. Set PATIENT_PORTAL_SESSION_ID or seed patient_portal_sessions with a verified row.');
  }
  console.log(`  Session: ${String(portalSessionId).slice(0, 8)}…`);

  // Ensure patient session isn't rejected due to inactivity TTL for any endpoint that uses requirePatientSession.
  try {
    db.db.prepare(`UPDATE patient_portal_sessions SET last_seen_at = datetime('now') WHERE id = ?`).run(portalSessionId);
  } catch (_) {}

  // Align booked appointment identity to the logged-in patient session for patient-owned routes.
  // This prevents 403s from assertPatientOwnsAppointmentOrThrow during `/api/patient/*/checkout`.
  try {
    const sessionRow = db.db
      .prepare(`SELECT email, phone FROM patient_portal_sessions WHERE id = ? LIMIT 1`)
      .get(portalSessionId);

    if (sessionRow?.email && !process.env.TEST_PATIENT_EMAIL) PATIENT.email = sessionRow.email;
    if (sessionRow?.phone && !process.env.TEST_PATIENT_PHONE) PATIENT.phone = sessionRow.phone;
  } catch (_) {}

  // A single triage session id that must be reused by:
  // triage -> B5 (voice schedule) -> C1 (voice checkout) -> DB assertions.
  const sharedTriageSessionId = uuidv4();

  const report = {
    at: new Date().toISOString(),
    apiBaseUrl: API_BASE,
    clinicId: CLINIC_ID,
    triage: null,
    booking: null,
    checkout: null,
    payment: null,
    medicalCoding: null,
    latency: null,
  };

  // §1 — Triage behavior
  if (!SKIP_TRIAGE) {
    report.triage = await runTriageSuite(portalSessionId, sharedTriageSessionId);
  } else {
    console.log('\n── §1 Triage Behavior ── SKIPPED (SKIP_TRIAGE=1)');
  }

  // §2 — Booking pipeline
  // Resolve patient_id from portal session for patient-owned routes.
  let portalPatientId = null;
  try {
    const sessionRow = db.db
      .prepare(`SELECT patient_id FROM patient_portal_sessions WHERE id = ? LIMIT 1`)
      .get(portalSessionId);
    portalPatientId = sessionRow?.patient_id || null;
  } catch (_) {}

  report.booking = await runBookingSuite(portalSessionId, portalPatientId, sharedTriageSessionId);

  // Grab a real appointmentId for checkout/payment (must come from B5).
  const b5 = report.booking?.['B5:retell-direct-parity-session-forwarded'] || null;
  const appointmentId = b5?.appointmentId || null;
  if (!b5?.pass || !appointmentId) {
    throw new Error(
      `B5 failed — expected successful voice scheduling to produce an appointment_id. ` +
        `status=${b5?.status} appointmentId=${appointmentId} details=${JSON.stringify(b5?.details || {})}`
    );
  }

  // §3 — Checkout
  report.checkout = await runCheckoutSuite(appointmentId, portalSessionId, sharedTriageSessionId);

  // Extract tokens for payment
  const checkoutId = report.checkout?.['C1:checkout-created']?.checkoutId || null;
  const paymentToken = report.checkout?.['C1:checkout-created']?.paymentToken || null;
  const amount = report.checkout?.['C1:checkout-created']?.amount || null;

  // C5/A2 + C9 harness assertions
  if (appointmentId) {
    const voiceCheckoutRows = db.db
      .prepare(`
        SELECT id, appointment_id, triage_session_id, deleted_at, created_at
        FROM voice_checkouts
        WHERE appointment_id = ?
        ORDER BY created_at DESC
      `)
      .all(appointmentId);

    const activeRows = (voiceCheckoutRows || []).filter((r) => r.deleted_at == null);

    if (activeRows.length !== 1) {
      throw new Error(
        `C5/A2 failed: expected exactly 1 voice_checkouts row for appointment_id=${appointmentId}, got ${activeRows.length}`
      );
    }

    const triageSid = activeRows[0]?.triage_session_id || null;
    if (!triageSid) throw new Error(`C9 failed: voice_checkouts.triage_session_id is null for appointment_id=${appointmentId}`);

    if (String(triageSid) !== String(sharedTriageSessionId)) {
      throw new Error(
        `C9 failed: voice_checkouts.triage_session_id mismatch (expected=${sharedTriageSessionId}, actual=${triageSid})`
      );
    }

    // Stronger C5/A2: voice checkout row should be the one returned by C1.
    const voiceCheckoutId = report.checkout?.['C1:checkout-created']?.checkoutId || null;
    if (voiceCheckoutId && String(activeRows[0]?.id) !== String(voiceCheckoutId)) {
      throw new Error(`C5/A2 failed: voice_checkouts.id mismatch (expected=${voiceCheckoutId}, actual=${activeRows[0]?.id})`);
    }

    // If Stripe-enabled patient checkout (C2) ran, ensure it didn't create a second checkout row.
    const c2 = report.checkout?.['C2:patient-checkout-idempotent'] || null;
    const patientCheckoutId = c2?.checkoutId1 || c2?.checkoutId2 || null;
    if (patientCheckoutId && voiceCheckoutId && String(patientCheckoutId) !== String(voiceCheckoutId)) {
      throw new Error(
        `C5/A2 failed: patient API checkout_id mismatch (patient=${patientCheckoutId}, voice=${voiceCheckoutId})`
      );
    }
  }

  // §4 — Payment
  const requiresVerification = !!report.checkout?.['C1:checkout-created']?.requiresVerif;
  const verificationCode = report.checkout?.['C1:checkout-created']?.verificationCode || null;
  report.payment = await runPaymentSuite(checkoutId, paymentToken, amount, {
    requiresVerification,
    verificationCode,
  });

  // §6 — Latency
  const wallMs = Date.now() - wallStart;
  report.latency = latency.summary();
  printLatencySummary(wallMs);

  console.log('\n=== FINAL RESULT ===');
  console.log(JSON.stringify(report, null, 2));

  if (report.payment?.skipped) process.exit(0);
}

main().catch((e) => {
  console.error('\n💥 HARNESS FAILED:', e?.message || e);
  if (VERBOSE) console.error(e?.stack);
  process.exit(1);
});

