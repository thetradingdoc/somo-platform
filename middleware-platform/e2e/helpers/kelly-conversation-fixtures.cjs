'use strict';

/**
 * Kelly conversation E2E fixtures — seed triage/booking state and assert orchestrator phase.
 * Used by e2e-kelly-rcm-pay-conversation.cjs, e2e-kelly-booking-fixture.cjs, e2e-kelly-pay-fixture.cjs.
 */

const crypto = require('crypto');
const path = require('path');

function loadDb() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'middleware-dev.db');
  const dbModule = require(path.join(__dirname, '..', '..', 'database'));
  return { dbModule, dbPath };
}

function newE2eSessionId(prefix = 'e2e') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function metaTrue(val) {
  const v = String(val || '').toLowerCase();
  return v === '1' || v === 'true';
}

function getKellyToolExecutor() {
  return require(path.join(__dirname, '..', '..', 'services', 'kelly-tool-executor'));
}

function getTriageRagService() {
  return require(path.join(__dirname, '..', '..', 'services', 'triage-rag-service'));
}

function getOrchestratorPhase() {
  return require(path.join(__dirname, '..', '..', 'services', 'kelly-orchestrator-phase'));
}

function readKellyState(sessionId) {
  const KellyToolExecutor = getKellyToolExecutor();
  const TriageRAGService = getTriageRagService();
  const { dbModule } = loadDb();

  const sessionRow = dbModule.getTriageSession ? dbModule.getTriageSession(sessionId) : null;
  const ragRow = TriageRAGService.getLatestForSession(sessionId);
  const phase = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_orchestrator_phase');
  const routineIntakeActive = KellyToolExecutor._getSessionMeta(sessionId, 'routine_intake_active');
  const detectedLanguage =
    sessionRow?.detected_language ||
    KellyToolExecutor._getSessionMeta(sessionId, 'detected_language') ||
    null;

  return {
    phase: phase || null,
    triage_complete: !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true)),
    opqrst_complete: !!(sessionRow && (sessionRow.opqrst_complete === 1 || sessionRow.opqrst_complete === true)),
    hasRag: !!ragRow,
    rag_confidence: ragRow?.rag_confidence ?? null,
    rag_result_id: sessionRow?.rag_result_id ?? null,
    detected_language: detectedLanguage,
    routine_intake_active: metaTrue(routineIntakeActive),
    target_specialty: sessionRow?.target_specialty || ragRow?.target_specialty || null,
  };
}

function setMeta(sessionId, key, value) {
  const KellyToolExecutor = getKellyToolExecutor();
  KellyToolExecutor._setSessionMeta(sessionId, key, value);
}

/**
 * Ensure an online provider with availability blocks for slot lookup (any specialty).
 */
function seedE2eBookableProvider(clinicId, opts = {}) {
  const specialty = opts.specialty || opts.targetSpecialty || 'Dermatology';
  const email = (opts.providerEmail || process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@doclittle.com')
    .trim()
    .toLowerCase();
  const ProviderService = require(path.join(__dirname, '..', '..', 'services', 'provider-service'));
  const { dbModule } = loadDb();
  const customer = dbModule.getCustomerByEmail?.(email);
  if (customer) {
    dbModule.updateCustomer(customer.id, {
      provider_profile: JSON.stringify({ specialty }),
    });
  }
  const profile = ProviderService.ensureProviderProfileForEmail(email, clinicId);
  if (profile?.id) {
    try {
      dbModule.db
        .prepare(
          `UPDATE provider_profiles SET specialty = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?`
        )
        .run(JSON.stringify([specialty]), profile.id);
    } catch (_) {}
  }
  ProviderService.setProviderOnline(email, true);
  try {
    dbModule.db
      .prepare(
        `UPDATE provider_status
         SET is_online = 1,
             heartbeat_expires_at = datetime('now', '+24 hours'),
             last_seen_at = datetime('now'),
             updated_at = datetime('now')
         WHERE lower(email) = lower(?)`
      )
      .run(email);
  } catch (_) {}
  let inserted = 0;
  const now = new Date();
  for (let d = 0; d < 60; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const dateStr = date.toISOString().slice(0, 10);
    try {
      ProviderService.createAvailabilityBlock({
        id: `avb_e2e_${crypto.randomBytes(6).toString('hex')}`,
        provider_email: email,
        block_type: 'available',
        start_datetime: `${dateStr}T09:00:00`,
        end_datetime: `${dateStr}T18:00:00`,
        title: `E2E ${specialty} availability`,
      });
      inserted++;
    } catch (e) {
      if (!String(e.message || '').includes('UNIQUE')) {
        /* ignore duplicate blocks */
      }
    }
  }
  return { email, profileId: profile?.id, specialty, blocksInserted: inserted };
}

/** @deprecated use seedE2eBookableProvider */
const seedE2eBookableDermProvider = seedE2eBookableProvider;

function teardownKellySession(sessionId) {
  const { dbModule } = loadDb();
  if (dbModule.wipeChatSessionClinicalState) {
    return dbModule.wipeChatSessionClinicalState(sessionId);
  }
  return { ok: false };
}

/**
 * S0-2: OPQRST complete, no RAG row yet.
 */
function seedTriageComplete(sessionId, patientId, opts = {}) {
  const { dbModule } = loadDb();
  teardownKellySession(sessionId);

  setMeta(sessionId, 'routine_intake_active', '0');
  setMeta(sessionId, 'detected_language', opts.language || 'en');

  dbModule.upsertTriageSession({
    session_id: sessionId,
    patient_id: patientId || null,
    quality: opts.quality || 'itchy rash on arm',
    onset: opts.onset || '1 week ago',
    severity: opts.severity ?? 3,
    provocation: opts.provocation || 'scratching',
    region: opts.region || 'arm',
    target_specialty: opts.targetSpecialty || 'Dermatology',
    detected_language: opts.language || 'en',
    opqrst_complete: 1,
    triage_complete: 0,
    referred_to_911: 0,
    safety_level: 'green',
    urgency: 'routine',
  });

  setMeta(sessionId, 'step1_skin_type_value', opts.skinType || 'dry');
  setMeta(sessionId, 'step1_skin_type_status', 'confirmed');
  setMeta(sessionId, 'body_sites', opts.region || 'arm');
  setMeta(sessionId, 'kelly_orchestrator_phase', 'TRIAGE_ACTIVE');

  return readKellyState(sessionId);
}

function seedOrchestrateContinuity(sessionId, patientId, opts = {}) {
  const { dbModule } = loadDb();
  if (!dbModule.upsertOrchestrateSession) return;
  dbModule.upsertOrchestrateSession({
    session_id: sessionId,
    patient_id: patientId,
    channel: 'chat',
    clinic_id: opts.clinicId || process.env.TEST_CLINIC_ID || 'clinic-default',
    turn_count: opts.turnCount ?? 3,
    conversation_history: opts.history || [
      { role: 'user', content: 'E2E seeded prior user turn' },
      { role: 'assistant', content: 'E2E seeded prior assistant turn' },
    ],
    flow_state: opts.flowState || { session_id: sessionId },
    status: 'active',
  });
}

/**
 * S0-3: Full booking-ready fixture — all meta + triage + RAG rows.
 */
function seedBookingReady(sessionId, patientId, clinicId, opts = {}) {
  const { dbModule } = loadDb();
  const TriageRAGService = getTriageRagService();
  const ragId = opts.ragId || `rag_e2e_${crypto.randomBytes(8).toString('hex')}`;
  const ragConfidence = opts.ragConfidence ?? 0.92;
  const targetSpecialty = opts.targetSpecialty || 'Dermatology';
  const nowIso = new Date().toISOString();

  teardownKellySession(sessionId);

  seedE2eBookableProvider(clinicId, { ...opts, specialty: targetSpecialty });

  setMeta(sessionId, 'routine_intake_active', '0');
  setMeta(sessionId, 'kelly_triage_reopen', '0');
  setMeta(sessionId, 'detected_language', opts.language || 'en');
  setMeta(sessionId, 'step1_skin_type_value', opts.skinType || 'dry');
  setMeta(sessionId, 'step1_skin_type_status', 'confirmed');
  setMeta(sessionId, 'body_sites', opts.region || 'arm');

  if (process.env.KELLY_E2E_SKIP_TRIAGE === '1') {
    setMeta(sessionId, 'kelly_e2e_skip_triage', '1');
  }

  try {
    const cols = new Set(dbModule.db.prepare(`PRAGMA table_info(triage_rag_results)`).all().map((c) => c.name));
    const ragPayload = {
      id: ragId,
      session_id: sessionId,
      patient_id: patientId || null,
      symptom_text: opts.symptomText || 'itchy rash on arm for one week, dry skin',
      opqrst_json: JSON.stringify({ quality: 'rash', onset: '1 week', severity: 3 }),
      icd_codes: JSON.stringify([{ code: 'L30.9', description: 'Dermatitis' }]),
      cpt_codes: JSON.stringify(['99213']),
      target_specialty: targetSpecialty,
      secondary_specialties: JSON.stringify([targetSpecialty]),
      urgency: 'routine',
      safety_level: 'green',
      red_flags: JSON.stringify([]),
      recommended_lane: 'sync',
      patient_friendly_summary: 'E2E seeded derm triage',
      specialist_context: 'E2E fixture',
      differentials: JSON.stringify([{ icd10: 'L30.9', description: 'Contact dermatitis', probability: 0.7 }]),
      soap_note: 'E2E SOAP seed for booking fixture.',
      rag_confidence: ragConfidence,
      created_at: nowIso,
    };
    const insertCols = Object.keys(ragPayload).filter((k) => cols.has(k));
    const placeholders = insertCols.map(() => '?').join(', ');
    const values = insertCols.map((k) => ragPayload[k]);
    dbModule.db
      .prepare(`INSERT INTO triage_rag_results (${insertCols.join(', ')}) VALUES (${placeholders})`)
      .run(...values);
  } catch (e) {
    throw new Error(`seedBookingReady: triage_rag_results insert failed: ${e.message}`);
  }

  dbModule.upsertTriageSession({
    session_id: sessionId,
    patient_id: patientId || null,
    rag_result_id: ragId,
    quality: opts.quality || 'itchy rash on arm',
    onset: opts.onset || '1 week ago',
    severity: opts.severity ?? 3,
    provocation: opts.provocation || 'scratching',
    region: opts.region || 'arm',
    safety_level: 'green',
    urgency: 'routine',
    target_specialty: targetSpecialty,
    soap_note: 'E2E booking fixture SOAP',
    detected_language: opts.language || 'en',
    triage_complete: 1,
    opqrst_complete: 1,
    referred_to_911: 0,
    intake_complete_at: nowIso,
    media_requested: false,
    media_received: false,
    media_ids: [],
  });

  setMeta(sessionId, 'kelly_orchestrator_phase', 'BOOKING');

  if (opts.patientName) setMeta(sessionId, 'collected_name', opts.patientName);
  if (opts.patientEmail) setMeta(sessionId, 'collected_email', opts.patientEmail);
  if (opts.patientPhone) setMeta(sessionId, 'collected_phone', opts.patientPhone);

  seedOrchestrateContinuity(sessionId, patientId, { clinicId, turnCount: 4 });

  const state = readKellyState(sessionId);
  if (!TriageRAGService.getLatestForSession(sessionId)) {
    throw new Error('seedBookingReady: RAG row not readable after insert');
  }
  return state;
}

/**
 * S2-6: Pay-ready fixture — booking done + journey + eligibility copay.
 */
function seedPayReady(sessionId, patientId, clinicId, opts = {}) {
  const { dbModule } = loadDb();
  seedBookingReady(sessionId, patientId, clinicId, opts);

  const copayAmount = opts.copayAmount ?? 25;
  const eligId = `elig_e2e_${crypto.randomBytes(6).toString('hex')}`;
  try {
    dbModule.db
      .prepare(
        `INSERT INTO eligibility_checks
         (id, patient_id, member_id, payer_id, copay_amount, eligible, created_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`
      )
      .run(eligId, patientId, opts.memberId || 'MBR-E2E-001', opts.payerId || '60054', copayAmount);
  } catch (_) {
    /* table may exist with different schema */
  }

  let journeyId = opts.journeyId || null;
  try {
    const orchestrator = require(path.join(__dirname, '..', '..', 'services', 'rcm-journey-orchestrator'));
    orchestrator.ensureKellyRcmTables?.();
    const started = orchestrator.startJourney({
      clinicId,
      patientId,
      source: 'e2e_pay_fixture',
      stage: 'registration',
      skipGates: true,
    });
    journeyId = started.journey?.id || started.journey_id || journeyId;
  } catch (e) {
    console.warn('[seedPayReady] journey start:', e.message);
  }

  if (journeyId) {
    setMeta(sessionId, 'rcm_journey_id', journeyId);
  }
  setMeta(sessionId, 'kelly_orchestrator_phase', 'BILLING');

  return { ...readKellyState(sessionId), journeyId, copayAmount };
}

/**
 * S0-3a: Preflight — same gates as get_available_slots (without calling slots API).
 */
function verifyBookingFixtureGates(sessionId) {
  const { dbModule } = loadDb();
  const TriageRAGService = getTriageRagService();
  const KellyToolExecutor = getKellyToolExecutor();
  const THRESHOLD = parseFloat(process.env.RAG_CONFIDENCE_THRESHOLD || '0.7');
  const errors = [];

  const sessionRow = dbModule.getTriageSession ? dbModule.getTriageSession(sessionId) : null;
  if (!sessionRow) errors.push('missing triage_sessions row');
  if (sessionRow && !sessionRow.triage_complete) errors.push('triage_complete != 1');
  if (sessionRow && !sessionRow.opqrst_complete) errors.push('opqrst_complete != 1');

  const triageReopen = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_triage_reopen');
  if (metaTrue(triageReopen)) errors.push('kelly_triage_reopen is set');

  const ragRow = TriageRAGService.getAuthoritativeForSession
    ? TriageRAGService.getAuthoritativeForSession(sessionId)
    : TriageRAGService.getLatestForSession(sessionId);
  if (!ragRow) errors.push('no triage_rag_results row');
  if (ragRow && sessionRow?.rag_result_id && String(sessionRow.rag_result_id) !== String(ragRow.id)) {
    errors.push(`rag_result_id mismatch: session=${sessionRow.rag_result_id} latest=${ragRow.id}`);
  }
  if (ragRow) {
    const conf = parseFloat(ragRow.rag_confidence);
    const skipTriage =
      process.env.KELLY_E2E_SKIP_TRIAGE === '1' ||
      metaTrue(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_e2e_skip_triage'));
    if (!skipTriage && (!Number.isFinite(conf) || conf < THRESHOLD)) {
      errors.push(`rag_confidence ${conf} < ${THRESHOLD}`);
    }
    let diffs = ragRow.differentials;
    if (typeof diffs === 'string') {
      try {
        diffs = JSON.parse(diffs);
      } catch (_) {
        diffs = [];
      }
    }
    if (!skipTriage && (!Array.isArray(diffs) || diffs.length < 1) && !ragRow.target_specialty) {
      errors.push('no differentials or target_specialty on RAG row');
    }
  }

  const phase = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_orchestrator_phase');
  if (phase !== 'BOOKING') errors.push(`phase=${phase} expected BOOKING`);

  return {
    ok: errors.length === 0,
    errors,
    category: errors.length ? 'FIXTURE_GAP' : 'OK',
    state: readKellyState(sessionId),
  };
}

/**
 * S0-1: Assert clinic visit path (not skincare routine intake).
 */
function assertClinicVisitPath(sessionId) {
  const state = readKellyState(sessionId);
  const badPhases = ['ROUTINE_INTAKE', 'ROUTINE_FOLLOWUP'];
  if (badPhases.includes(state.phase)) {
    throw new Error(`S0-1: on skincare path phase=${state.phase}`);
  }
  if (state.routine_intake_active) {
    throw new Error('S0-1: routine_intake_active=1 (skincare consumer path)');
  }
  return state;
}

/**
 * S0-4: Assert Kelly state after each turn.
 */
function assertKellyState(sessionId, expected = {}) {
  const state = readKellyState(sessionId);
  const mismatches = [];

  if (expected.phase != null) {
    const allowed = Array.isArray(expected.phase) ? expected.phase : [expected.phase];
    if (!allowed.includes(state.phase)) {
      mismatches.push(`phase: expected ${allowed.join('|')} got ${state.phase}`);
    }
  }
  if (expected.triage_complete != null && state.triage_complete !== expected.triage_complete) {
    mismatches.push(`triage_complete: expected ${expected.triage_complete} got ${state.triage_complete}`);
  }
  if (expected.hasRag != null && state.hasRag !== expected.hasRag) {
    mismatches.push(`hasRag: expected ${expected.hasRag} got ${state.hasRag}`);
  }
  if (expected.detected_language != null && state.detected_language !== expected.detected_language) {
    mismatches.push(
      `detected_language: expected ${expected.detected_language} got ${state.detected_language}`
    );
  }
  if (expected.routine_intake_active != null && state.routine_intake_active !== expected.routine_intake_active) {
    mismatches.push(
      `routine_intake_active: expected ${expected.routine_intake_active} got ${state.routine_intake_active}`
    );
  }

  const line = `[KellyState] session=${sessionId.slice(0, 24)}… phase=${state.phase} triage_complete=${state.triage_complete} hasRag=${state.hasRag} lang=${state.detected_language}`;
  if (mismatches.length) {
    throw new Error(`${line}\n${mismatches.join('; ')}`);
  }
  return { state, log: line };
}

/**
 * A9 / A7: Seed verified patient portal session for triage.html (x-session-id / localStorage).
 * Uses patient_portal_sessions (validated by PatientPortalService.validateSession).
 */
function seedPatientSessionForE2e(patientId, email = 'e2e-wallet@somo.test') {
  const { dbModule } = loadDb();
  const sessionId = `ps_e2e_${crypto.randomBytes(12).toString('hex')}`;
  const normalizedEmail = String(email).toLowerCase().trim();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  try {
    dbModule.db
      .prepare(
        `INSERT INTO patient_portal_sessions
         (id, email, patient_id, verification_code, verified, verified_at, expires_at, created_at, last_seen_at, failed_attempts)
         VALUES (?, ?, ?, '000000', 1, ?, ?, ?, ?, 0)`
      )
      .run(sessionId, normalizedEmail, patientId || null, nowIso, expires, nowIso, nowIso);
  } catch (e) {
    throw new Error(`seedPatientSessionForE2e failed: ${e.message}`);
  }

  if (dbModule.createPatientSession) {
    dbModule.createPatientSession({
      session_id: sessionId,
      email: normalizedEmail,
      patient_id: patientId,
      expires_at: expires,
    });
  }

  return sessionId;
}

/**
 * A1: Create or reuse FHIR test patient.
 */
function seedPatient(opts = {}) {
  const { dbModule } = loadDb();
  const phone = opts.phone || process.env.TEST_PATIENT_PHONE || '+15550009991';
  const email = opts.email || 'e2e-golden-path@somo.test';

  let patient = dbModule.getFHIRPatientByPhone?.(phone);
  if (!patient) {
    const resourceId = `Patient/e2e-golden-${crypto.randomBytes(6).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: ['E2E'], family: 'GoldenPath' }],
      telecom: [
        { system: 'phone', value: phone },
        { system: 'email', value: email },
      ],
      birthDate: '1990-01-15',
    });
    patient = dbModule.getFHIRPatient(resourceId);
  }

  if (!patient?.resource_id) {
    throw new Error(`seedPatient failed for phone ${phone}`);
  }

  return {
    patientId: patient.resource_id,
    phone,
    email,
  };
}

/**
 * A2: Seed eligibility copay for patient.
 */
function seedEligibility(patientId, copayAmount = 25, opts = {}) {
  const { dbModule } = loadDb();
  if (!patientId) throw new Error('seedEligibility requires patientId');

  if (process.env.STEDI_API_KEY) {
    return { copayAmount, source: 'live Stedi (not seeded)' };
  }

  const existing = dbModule.db
    .prepare(`SELECT id FROM eligibility_checks WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(patientId);

  if (existing) {
    dbModule.db
      .prepare(`UPDATE eligibility_checks SET copay_amount = ?, eligible = 1 WHERE id = ?`)
      .run(copayAmount, existing.id);
  } else {
    dbModule.db
      .prepare(
        `INSERT INTO eligibility_checks
         (id, patient_id, member_id, payer_id, copay_amount, eligible, created_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`
      )
      .run(
        `elig-golden-${crypto.randomBytes(6).toString('hex')}`,
        patientId,
        opts.memberId || 'MBR-E2E-001',
        opts.payerId || '60054',
        copayAmount
      );
  }

  return { copayAmount, source: 'seeded' };
}

/**
 * A3: Open RCM journey for patient.
 */
function seedOpenJourney(clinicId, patientId, opts = {}) {
  const { dbModule } = loadDb();
  const clinic = clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';
  if (!patientId) throw new Error('seedOpenJourney requires patientId');

  const orchestrator = require(path.join(__dirname, '..', '..', 'services', 'rcm-journey-orchestrator'));
  orchestrator.ensureKellyRcmTables?.();

  const open = dbModule.db
    .prepare(
      `SELECT id FROM rcm_journeys WHERE clinic_id = ? AND patient_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`
    )
    .get(clinic, patientId);

  if (open) {
    return { journeyId: open.id, created: false };
  }

  const started = orchestrator.startJourney({
    clinicId: clinic,
    patientId,
    source: opts.source || 'e2e_golden_path',
    stage: opts.stage || 'registration',
    skipGates: true,
  });

  const journeyId = started.journey?.id || started.journey_id;
  return { journeyId, created: true };
}

/**
 * A4: Resolve pay token from Kelly meta or rcm_payments.
 */
function resolvePayToken(kellySessionId, patientId, clinicId) {
  const KellyToolExecutor = getKellyToolExecutor();
  const { dbModule } = loadDb();
  const clinic = clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';

  const fromMeta = KellyToolExecutor._getSessionMeta(kellySessionId, 'rcm_pay_token');
  if (fromMeta) return String(fromMeta);

  try {
    const row = dbModule.db
      .prepare(
        `SELECT pay_token FROM rcm_payments
         WHERE patient_id = ? AND clinic_id = ?
         ORDER BY requested_at DESC LIMIT 1`
      )
      .get(patientId, clinic);
    if (row?.pay_token) return String(row.pay_token);
  } catch (_) {}

  return null;
}

/**
 * A5: Read tool names from kelly conversation history (fallback).
 */
function readToolsUsedFromHistory(sessionId) {
  const { dbModule } = loadDb();
  try {
    const rows = dbModule.db
      .prepare(
        `SELECT content FROM kelly_conversation_history
         WHERE session_id = ? AND role = 'assistant'
         ORDER BY id DESC LIMIT 5`
      )
      .all(sessionId);
    const tools = new Set();
    for (const row of rows) {
      const text = String(row.content || '');
      const matches = text.match(/\[tool:([a-z_]+)\]/gi) || [];
      for (const m of matches) {
        tools.add(m.replace(/\[tool:/i, '').replace(']', '').toLowerCase());
      }
    }
    return [...tools];
  } catch (_) {
    return [];
  }
}

function assertPaymentPaid(payToken) {
  const { dbModule } = loadDb();
  const row = dbModule.db
    .prepare(`SELECT status FROM rcm_payments WHERE pay_token = ? LIMIT 1`)
    .get(payToken);
  if (!row || String(row.status).toLowerCase() !== 'paid') {
    throw new Error(`S3: payment not paid for token=${payToken?.slice(0, 8)} status=${row?.status || 'missing'}`);
  }
  return row;
}

/**
 * A6: One-shot golden path Node setup.
 */
function setupGoldenPathContext(opts = {}) {
  process.chdir(path.join(__dirname, '..', '..'));
  process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'middleware-dev.db');

  const clinicId = opts.clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';
  const sessionId = opts.sessionId || newE2eSessionId('e2e_golden');
  const patient = seedPatient(opts);
  const eligibility = seedEligibility(patient.patientId, opts.copayAmount ?? 25);
  const journey = seedOpenJourney(clinicId, patient.patientId, opts);
  const portalSessionId = seedPatientSessionForE2e(patient.patientId, patient.email);

  if (journey.journeyId) {
    setMeta(sessionId, 'rcm_journey_id', journey.journeyId);
  }

  let skipTriagePreflight = null;
  if (process.env.KELLY_E2E_SKIP_TRIAGE === '1') {
    seedBookingReady(sessionId, patient.patientId, clinicId, {
      patientName: 'E2E GoldenPath',
      patientEmail: patient.email,
      patientPhone: patient.phone,
      targetSpecialty: opts.targetSpecialty || 'Dermatology',
      ...opts,
    });
    getKellyToolExecutor()._setSessionMeta(sessionId, 'kelly_e2e_skip_triage', '1');
    skipTriagePreflight = verifyBookingFixtureGates(sessionId);
    if (!skipTriagePreflight.ok) {
      throw new Error(`S0-3 FIXTURE_GAP: ${skipTriagePreflight.errors.join('; ')}`);
    }
  }

  return {
    clinicId,
    sessionId,
    patientId: patient.patientId,
    patientPhone: patient.phone,
    patientEmail: patient.email,
    portalSessionId,
    journeyId: journey.journeyId,
    copayAmount: eligibility.copayAmount,
    skipTriagePreflight,
    turnLog: [],
    payToken: null,
  };
}

module.exports = {
  newE2eSessionId,
  loadDb,
  readKellyState,
  teardownKellySession,
  seedTriageComplete,
  seedBookingReady,
  seedPayReady,
  verifyBookingFixtureGates,
  assertClinicVisitPath,
  assertKellyState,
  getKellyToolExecutor,
  getOrchestratorPhase,
  seedPatientSessionForE2e,
  seedPatient,
  seedEligibility,
  seedOpenJourney,
  seedOrchestrateContinuity,
  seedE2eBookableProvider,
  seedE2eBookableDermProvider,
  resolvePayToken,
  readToolsUsedFromHistory,
  assertPaymentPaid,
  setupGoldenPathContext,
  setMeta,
};

