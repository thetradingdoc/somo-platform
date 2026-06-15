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
  const defaultEmail =
    specialty === 'Dermatology'
      ? 'maria.santos@doclittle.example'
      : process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';
  const email = (opts.providerEmail || defaultEmail).trim().toLowerCase();
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
          `UPDATE provider_profiles
           SET clinic_id = ?, specialty = ?, is_active = 1, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(clinicId, JSON.stringify([specialty]), profile.id);
      dbModule.db
        .prepare(
          `INSERT INTO provider_status (provider_id, email, is_online, last_seen_at, heartbeat_expires_at, updated_at)
           VALUES (?, ?, 1, datetime('now'), datetime('now', '+24 hours'), datetime('now'))
           ON CONFLICT(email) DO UPDATE SET
             provider_id = excluded.provider_id,
             is_online = 1,
             heartbeat_expires_at = datetime('now', '+24 hours'),
             last_seen_at = datetime('now'),
             updated_at = datetime('now')`
        )
        .run(profile.id, email);
    } catch (_) {}
  }
  ProviderService.setProviderOnline(email, true);
  const online = ProviderService.getOnlineProvidersForClinic(clinicId);
  if (!online.length) {
    throw new Error(
      `seedE2eBookableProvider: no online providers for ${clinicId} (email=${email}). Check provider_profiles + provider_status.`
    );
  }
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
    dbModule.wipeChatSessionClinicalState(sessionId);
  }
  try {
    const KellyToolExecutor = getKellyToolExecutor();
    KellyToolExecutor._setSessionMeta(sessionId, 'rcm_pay_token', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'rcm_payment_id', '');
    KellyToolExecutor._setSessionMeta(sessionId, 'pay_url', '');
  } catch (_) {}
  return { ok: true };
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
  const KellyToolExecutor = getKellyToolExecutor();
  const graphBranch = String(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_graph_branch') || '');
  const badPhases = ['ROUTINE_INTAKE', 'ROUTINE_FOLLOWUP'];
  if (badPhases.includes(state.phase)) {
    throw new Error(`S0-1: on skincare path phase=${state.phase}`);
  }
  if (state.routine_intake_active) {
    throw new Error('S0-1: routine_intake_active=1 (skincare consumer path)');
  }
  if (graphBranch === 'education' || graphBranch === 'skincare_education') {
    throw new Error(`S0-1: on education lane branch=${graphBranch}`);
  }
  return state;
}

/**
 * S0-4: Assert Kelly state after each turn.
 */
function assertKellyState(sessionId, expected = {}) {
  const state = readKellyState(sessionId);
  const KellyToolExecutor = getKellyToolExecutor();
  const graphBranch = String(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_graph_branch') || '');
  const mismatches = [];

  if (expected.phase != null) {
    const allowed = Array.isArray(expected.phase) ? expected.phase : [expected.phase];
    const branchOk =
      (allowed.includes('BOOKING') && graphBranch === 'booking') ||
      (allowed.includes('TRIAGE_ACTIVE') && graphBranch === 'clinical') ||
      (allowed.includes('TRIAGE_DISCOVERY') && (graphBranch === 'basic_intake' || graphBranch === 'clinical'));
    if (!allowed.includes(state.phase) && !branchOk) {
      mismatches.push(`phase: expected ${allowed.join('|')} got ${state.phase} branch=${graphBranch}`);
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
  const given = opts.given || (opts.patientName ? String(opts.patientName).split(/\s+/)[0] : 'E2E');
  const family =
    opts.family || (opts.patientName ? String(opts.patientName).split(/\s+/).slice(1).join(' ') || 'Test' : 'GoldenPath');

  let patient = dbModule.getFHIRPatientByPhone?.(phone);
  if (!patient && email && dbModule.db) {
    try {
      const row = dbModule.db
        .prepare(`SELECT resource_id FROM fhir_patients WHERE lower(email) = lower(?) LIMIT 1`)
        .get(email);
      if (row?.resource_id) patient = dbModule.getFHIRPatient(row.resource_id);
    } catch (_) {}
  }
  if (!patient) {
    const resourceId = `Patient/e2e-golden-${crypto.randomBytes(6).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: [given], family }],
      telecom: [
        { system: 'phone', value: phone },
        { system: 'email', value: email },
      ],
      birthDate: opts.birthDate || '1990-01-15',
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
    patientName: `${given} ${family}`.trim(),
  };
}

const TOM_HARRIS_EMAIL = 'drlittlekids@gmail.com';
const TOM_HARRIS_PHONE = process.env.TOM_HARRIS_PHONE || '+15550008877';

function seedTomHarrisPatient(opts = {}) {
  return seedPatient({
    phone: opts.phone || TOM_HARRIS_PHONE,
    email: opts.email || TOM_HARRIS_EMAIL,
    given: 'Tom',
    family: 'Harris',
    ...opts,
  });
}

function tomorrowAtNoonLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return {
    dateStr: `${y}-${m}-${day}`,
    startDatetime: `${y}-${m}-${day}T12:00:00`,
    endDatetime: `${y}-${m}-${day}T12:30:00`,
    label: 'tomorrow at 12:00 PM',
    time: '12:00',
  };
}

/** Local today at 2:00 PM — for provider today.html (same calendar day as ppFetchAppointmentsToday). */
function todayAtAfternoonLocal(opts = {}) {
  const d = new Date();
  const hour = opts.hour ?? 14;
  const minute = opts.minute ?? d.getMinutes() % 30;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const dateStr = `${y}-${m}-${day}`;
  const labelHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return {
    dateStr,
    startDatetime: `${dateStr}T${hh}:${mm}:00`,
    endDatetime: `${dateStr}T${hh}:${String((Number(minute) + 30) % 60).padStart(2, '0')}:00`,
    label: `today at ${labelHour}:${mm} ${ampm}`,
    time: `${hh}:${mm}`,
  };
}

function seedKellyRailsV2TurnResolved(sessionId, opts = {}) {
  const { dbModule } = loadDb();
  const tools = opts.toolsUsed || [
    'store_triage_opqrst',
    'run_triage_rag',
    'get_available_slots',
    'schedule_appointment',
    'request_patient_payment',
  ];
  dbModule.insertKellyCallEvent({
    session_id: sessionId,
    event_type: 'turn_resolved',
    payload_json: {
      runtime: 'kelly_rails_v2',
      tools_used: tools,
      lane: opts.lane || 'booking',
      ...opts.payload,
    },
  });
}

/**
 * Seed Tom Harris + v2 triage/RAG/journey + today's confirmed appointment (provider portal screenshot).
 */
async function seedV2ProviderDashboardToday(opts = {}) {
  const clinicId = opts.clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';
  const providerEmail =
    opts.providerEmail || process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';
  const sessionId = opts.sessionId || newE2eSessionId('e2e_v6_3');
  const patient = seedTomHarrisPatient(opts);
  const todaySlot = todayAtAfternoonLocal(opts);

  seedE2eBookableProvider(clinicId, {
    targetSpecialty: 'Dermatology',
    providerEmail,
  });
  seedBookingReady(sessionId, patient.patientId, clinicId, {
    region: 'leg and neck',
    quality: 'itchy rash on leg and neck',
    symptomText: 'itchy rash on leg and neck for one week',
    targetSpecialty: 'Dermatology',
    patientName: 'Tom Harris',
    patientEmail: patient.email,
    patientPhone: patient.phone,
  });
  seedOpenJourney(clinicId, patient.patientId, { stage: 'intake', source: 'kelly_rails_v2_e2e' });
  seedKellyRailsV2TurnResolved(sessionId, opts);

  const { dbModule: dbMod } = loadDb();
  try {
    dbMod.db
      .prepare(
        `DELETE FROM appointments WHERE clinic_id = ? AND date = ? AND patient_id = ?`
      )
      .run(clinicId, todaySlot.dateStr, patient.patientId);
  } catch (_) {}

  const appointmentId = await seedTomHarrisAppointment(sessionId, patient.patientId, clinicId, {
    noon: todaySlot,
    providerEmail,
    patientName: 'Tom Harris',
    email: patient.email,
    phone: patient.phone,
    appointmentId: opts.appointmentId,
  });

  const { dbModule } = loadDb();
  dbModule.db
    .prepare(`UPDATE appointments SET status = 'confirmed' WHERE id = ?`)
    .run(appointmentId);

  return {
    clinicId,
    sessionId,
    appointmentId,
    patientId: patient.patientId,
    patientEmail: patient.email,
    todaySlot,
    providerEmail,
  };
}

function seedE2eSlotTomorrowNoon(clinicId, opts = {}) {
  const providerEmail = (opts.providerEmail || process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com').trim();
  seedE2eBookableProvider(clinicId, { targetSpecialty: opts.targetSpecialty || 'Dermatology', providerEmail });
  const noon = tomorrowAtNoonLocal();
  const ProviderService = require(path.join(__dirname, '..', '..', 'services', 'provider-service'));
  try {
    ProviderService.createAvailabilityBlock({
      id: `avb_e2e_noon_${crypto.randomBytes(6).toString('hex')}`,
      provider_email: providerEmail,
      block_type: 'available',
      start_datetime: noon.startDatetime,
      end_datetime: noon.endDatetime,
      title: 'E2E tomorrow noon dermatology',
    });
  } catch (e) {
    if (!String(e.message || '').includes('UNIQUE')) throw e;
  }
  return { ...noon, providerEmail };
}

async function seedTomHarrisAppointment(sessionId, patientId, clinicId, opts = {}) {
  const { dbModule } = loadDb();
  const noon = opts.noon || tomorrowAtNoonLocal();
  const apptId = opts.appointmentId || `appt_f2_${crypto.randomBytes(8).toString('hex')}`;
  const providerEmail =
    opts.providerEmail || process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';

  await dbModule.createAppointment({
    id: apptId,
    clinic_id: clinicId,
    patient_id: patientId,
    patient_name: opts.patientName || 'Tom Harris',
    patient_email: opts.email || TOM_HARRIS_EMAIL,
    patient_phone: opts.phone || TOM_HARRIS_PHONE,
    appointment_type: 'Dermatology',
    date: noon.dateStr,
    time: noon.time || '12:00',
    start_time: noon.startDatetime,
    end_time: noon.endDatetime,
    duration_minutes: 30,
    provider: providerEmail,
    status: 'scheduled',
    visit_mode: 'sync_video',
  });

  try {
    const { persistCaseSummaryForAppointment } = require('../services/case-summary-service');
    persistCaseSummaryForAppointment({ appointmentId: apptId, sessionId });
  } catch (_) {}

  return apptId;
}

function clearRcmE2eEmailOutbox() {
  const { dbModule } = loadDb();
  try {
    dbModule.db.exec(`DELETE FROM rcm_e2e_email_outbox`);
  } catch (_) {}
}

function assertEmailSentTo(email, opts = {}) {
  const { dbModule } = loadDb();
  const normalized = String(email || '').toLowerCase();
  const since = opts.sinceMinutes ? `datetime('now', '-${opts.sinceMinutes} minutes')` : null;
  let rows = [];
  try {
    rows = since
      ? dbModule.db
          .prepare(
            `SELECT recipient, subject, template, success, created_at FROM rcm_e2e_email_outbox
             WHERE lower(recipient) = ? AND created_at >= ${since}
             ORDER BY id DESC`
          )
          .all(normalized)
      : dbModule.db
          .prepare(
            `SELECT recipient, subject, template, success, created_at FROM rcm_e2e_email_outbox
             WHERE lower(recipient) = ?
             ORDER BY id DESC`
          )
          .all(normalized);
  } catch (e) {
    throw new Error(
      `assertEmailSentTo: rcm_e2e_email_outbox missing (set RCM_E2E_RECORD_EMAIL=1 on server): ${e.message}`
    );
  }
  const template = opts.template ? String(opts.template).toLowerCase() : null;
  const filtered = template ? rows.filter((r) => String(r.template || '').toLowerCase() === template) : rows;
  const successOnly = opts.requireSuccess !== false;
  const hit = filtered.find((r) => {
    if (!successOnly) return true;
    const ok = r.success === 1 || r.success === true || String(r.success) === '1';
    return ok || (process.env.RCM_E2E_RECORD_EMAIL === '1' && r.recipient);
  });
  if (!hit) {
    throw new Error(
      `No email to ${email} template=${template || 'any'} success=${successOnly}. rows=${JSON.stringify(rows.slice(0, 3))}`
    );
  }
  if (opts.subjectFragment) {
    const frag = String(opts.subjectFragment).toLowerCase();
    if (!String(hit.subject || '').toLowerCase().includes(frag)) {
      throw new Error(`Email subject missing "${opts.subjectFragment}": ${hit.subject}`);
    }
  }
  return hit;
}

async function providerApiLogin(baseUrl, email, password) {
  const http = require('http');
  const https = require('https');
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/customers/login`);
  const payload = JSON.stringify({ email, password, remember_me: false });
  const lib = url.protocol === 'https:' ? https : http;
  let cookieJar = '';
  const res = await new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (r) => {
        let data = '';
        r.on('data', (c) => {
          data += c;
        });
        r.on('end', () => {
          const setCookie = r.headers['set-cookie'];
          if (setCookie) cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch (_) {}
          resolve({ status: r.statusCode, json, cookieJar });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
  if (res.status !== 200 || !res.json.success) {
    throw new Error(res.json.error || `Provider login HTTP ${res.status}`);
  }
  return res.cookieJar;
}

async function fetchClinicalPrep(baseUrl, cookieJar, appointmentId) {
  const http = require('http');
  const https = require('https');
  const url = new URL(
    `${baseUrl.replace(/\/$/, '')}/api/admin/appointments/${encodeURIComponent(appointmentId)}/clinical-prep`
  );
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      { method: 'GET', headers: { Cookie: cookieJar } },
      (r) => {
        let data = '';
        r.on('data', (c) => {
          data += c;
        });
        r.on('end', () => {
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch (_) {}
          resolve({ status: r.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function assertClinicalPrepInProcess(appointmentId, sessionId, opts = {}) {
  const { dbModule } = loadDb();
  let appt = null;
  try {
    appt = dbModule.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
  } catch (_) {}
  if (!appt && dbModule.getAppointment) {
    appt = dbModule.getAppointment(appointmentId);
  }
  if (!appt) throw new Error(`clinical-prep: appointment not found ${appointmentId}`);

  let caseSummaryRow = null;
  try {
    caseSummaryRow = dbModule.db
      .prepare('SELECT * FROM case_summaries WHERE appointment_id = ? LIMIT 1')
      .get(appointmentId);
  } catch (_) {}

  const { resolveTriageSessionIdForAppointment } = require('../../services/clinical-prep-session-resolve');
  const triageSessionId =
    caseSummaryRow?.session_id || resolveTriageSessionIdForAppointment(appointmentId, appt);
  const triage =
    triageSessionId && dbModule.getTriageSession ? dbModule.getTriageSession(triageSessionId) : null;

  const blob = JSON.stringify({ triage, caseSummaryRow, appt }).toLowerCase();
  if (opts.expectRash !== false && !/rash|leg|neck|itch|dermat/i.test(blob)) {
    throw new Error(`clinical-prep (in-process) missing rash/leg/neck: ${blob.slice(0, 300)}`);
  }
  if (sessionId && triageSessionId && triageSessionId !== sessionId) {
    throw new Error(`clinical-prep session mismatch: got ${triageSessionId} expected ${sessionId}`);
  }
  return { triage, caseSummaryRow, triageSessionId };
}

async function assertClinicalPrep(baseUrl, cookieJar, appointmentId, sessionId, opts = {}) {
  const res = await fetchClinicalPrep(baseUrl, cookieJar, appointmentId);
  if (res.status !== 200 || !res.json.success) {
    throw new Error(`clinical-prep HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`);
  }
  const prep = res.json.prep || res.json;
  const triage = prep.triage || prep.triage_session || null;
  const summary = prep.case_summary || null;
  const blob = JSON.stringify({ triage, summary, prep }).toLowerCase();
  if (opts.expectRash !== false) {
    if (!/rash|leg|neck|itch|dermat/i.test(blob)) {
      throw new Error(`clinical-prep missing rash/leg/neck context: ${blob.slice(0, 300)}`);
    }
  }
  if (sessionId) {
    const sid = String(prep.triage_session_id || triage?.session_id || caseSummarySession(prep) || '');
    if (sid && sid !== sessionId) {
      throw new Error(`clinical-prep session mismatch: got ${sid} expected ${sessionId}`);
    }
  }
  return prep;
}

function caseSummarySession(prep) {
  try {
    return prep?.case_summary?.session_id || null;
  } catch (_) {
    return null;
  }
}

/**
 * Ensure OPQRST + RAG rows exist for cold-start F2 (DB seed — no LLM call).
 */
function seedTriageWithRag(sessionId, patientId, clinicId, opts = {}) {
  const { completeTriageRagForSession } = require('../../services/triage-rag-fast-complete');
  completeTriageRagForSession(sessionId, patientId, {
    targetSpecialty: opts.targetSpecialty || 'Dermatology',
    region: opts.region || 'leg and neck',
    quality: opts.quality || 'itchy rash on leg and neck',
    patientName: opts.patientName || 'Tom Harris',
    email: opts.email || TOM_HARRIS_EMAIL,
    ragId: opts.ragId,
    ragConfidence: opts.ragConfidence,
  });
  setMeta(sessionId, 'kelly_graph_branch', 'clinical');
  return readKellyState(sessionId);
}

function ensureClinicalTriageReady(sessionId, patientId, clinicId, opts = {}) {
  return seedTriageWithRag(sessionId, patientId, clinicId, opts);
}

const TOM_HARRIS_MESSAGES = {
  t1: 'I have an itchy rash on my leg and neck for about a week. It is not an emergency — I would like dermatology help.',
  t2: 'It is dry skin type, not pregnant, moderate itch about 3 out of 5. It started last Tuesday on my leg and neck. No fever.',
  t2b: 'The rash is on my left leg and neck, red and scaly, worse at night. Severity is 3 out of 5.',
  t3: (noon) =>
    `Can you book me for ${noon?.label || 'tomorrow at 12:00 PM'} with dermatology? I am available at noon.`,
  t4: (email, noon) =>
    `Yes, please book the ${noon?.label || 'tomorrow at 12:00 PM'} slot. My email is ${email || TOM_HARRIS_EMAIL} and phone ${TOM_HARRIS_PHONE}.`,
  t5: 'I have BlueCross insurance. What will my copay be for this visit?',
  t6: (copay) =>
    `OK, I would like to pay ${copay || '$25'} now before the appointment. Please send me a secure payment link to my email.`,
};

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
  const tomHarris = process.env.KELLY_F2_TOM_HARRIS === '1' || opts.tomHarris === true;
  const patient = tomHarris ? seedTomHarrisPatient(opts) : seedPatient(opts);
  let tomorrowNoon = null;
  if (tomHarris) {
    clearRcmE2eEmailOutbox();
    tomorrowNoon = seedE2eSlotTomorrowNoon(clinicId, opts);
  }
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
    patientName: patient.patientName || 'Tom Harris',
    portalSessionId,
    journeyId: journey.journeyId,
    copayAmount: eligibility.copayAmount,
    skipTriagePreflight,
    turnLog: [],
    payToken: null,
    tomorrowNoon,
    tomHarris,
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
  seedTomHarrisPatient,
  seedTomHarrisAppointment,
  tomorrowAtNoonLocal,
  todayAtAfternoonLocal,
  seedKellyRailsV2TurnResolved,
  seedV2ProviderDashboardToday,
  seedE2eSlotTomorrowNoon,
  assertEmailSentTo,
  clearRcmE2eEmailOutbox,
  providerApiLogin,
  assertClinicalPrep,
  assertClinicalPrepInProcess,
  fetchClinicalPrep,
  TOM_HARRIS_EMAIL,
  TOM_HARRIS_PHONE,
  TOM_HARRIS_MESSAGES,
  ensureClinicalTriageReady,
  seedTriageWithRag,
};

