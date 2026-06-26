'use strict';

const crypto = require('crypto');
const db = require('../database');
const {
  RCM_STAGE_CONTRACT,
  normalizeStageId,
  isValidStageId,
  stageContractMap,
  resolveIntegrationState,
  actionStateLabel,
} = require('./rcm-stage-contract');

let __tablesReady = false;

function safeJsonParse(value) {
  if (value == null) return null;
  try {
    if (typeof value === 'string') return JSON.parse(value);
    return value;
  } catch (_) {
    return null;
  }
}

function ensureKellyRcmTables() {
  if (__tablesReady) return;
  const sqlite = db.db;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS rcm_journeys (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      patient_id TEXT,
      appointment_id TEXT,
      claim_id TEXT,
      call_id TEXT,
      source TEXT DEFAULT 'voice',
      stage TEXT DEFAULT 'pre_registration',
      status TEXT DEFAULT 'open',
      amount_due REAL DEFAULT 0,
      intake_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_journeys_clinic_created ON rcm_journeys(clinic_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rcm_journeys_stage ON rcm_journeys(stage);
    CREATE INDEX IF NOT EXISTS idx_rcm_journeys_clinic_patient_status ON rcm_journeys(clinic_id, patient_id, status);

    CREATE TABLE IF NOT EXISTS rcm_journey_events (
      id TEXT PRIMARY KEY,
      journey_id TEXT NOT NULL,
      clinic_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      stage_from TEXT,
      stage_to TEXT,
      payload_json TEXT,
      dedupe_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_events_journey ON rcm_journey_events(journey_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rcm_ledger_entries (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      journey_id TEXT,
      direction TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      category TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_ledger_clinic_created ON rcm_ledger_entries(clinic_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rcm_payments (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      journey_id TEXT,
      patient_id TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'requested',
      method TEXT DEFAULT 'manual',
      pay_token TEXT,
      reminder_count INTEGER DEFAULT 0,
      last_reminder_at DATETIME,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_payments_clinic_status ON rcm_payments(clinic_id, status);

    CREATE TABLE IF NOT EXISTS rcm_remittances (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      journey_id TEXT,
      payer_name TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'posted',
      posted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_remit_clinic_posted ON rcm_remittances(clinic_id, posted_at DESC);
  `);

  const migrations = [
    'ALTER TABLE rcm_journeys ADD COLUMN appointment_id TEXT',
    'ALTER TABLE rcm_journeys ADD COLUMN claim_id TEXT',
    'ALTER TABLE rcm_journeys ADD COLUMN call_id TEXT',
    'ALTER TABLE rcm_journeys ADD COLUMN intake_json TEXT',
    'ALTER TABLE rcm_journey_events ADD COLUMN dedupe_key TEXT',
    'ALTER TABLE rcm_payments ADD COLUMN pay_token TEXT',
    'ALTER TABLE rcm_payments ADD COLUMN reminder_count INTEGER DEFAULT 0',
    'ALTER TABLE rcm_payments ADD COLUMN last_reminder_at DATETIME',
    'ALTER TABLE rcm_payments ADD COLUMN circle_transfer_id TEXT',
    'ALTER TABLE rcm_payments ADD COLUMN stripe_payment_intent_id TEXT',
    'ALTER TABLE voice_call_log ADD COLUMN clinic_id TEXT',
  ];
  for (const sql of migrations) {
    try {
      sqlite.exec(sql);
    } catch (_) {
      /* column exists */
    }
  }

  try {
    sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_rcm_events_dedupe ON rcm_journey_events(journey_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
    );
  } catch (_) {
    /* index exists or dedupe_key not yet available */
  }

  __tablesReady = true;
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDedupeKey(eventType, stageTo, payload) {
  const raw = JSON.stringify({ eventType, stageTo, payload: payload || {} });
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function getJourney(clinicId, journeyId) {
  ensureKellyRcmTables();
  return db.db
    .prepare(`SELECT * FROM rcm_journeys WHERE id = ? AND clinic_id = ?`)
    .get(String(journeyId), String(clinicId));
}

function enrichJourney(row) {
  if (!row) return null;
  const stageId = normalizeStageId(row.stage);
  const contract = stageContractMap().get(stageId) || null;
  return {
    ...row,
    stage: stageId,
    intake: safeJsonParse(row.intake_json),
    stage_contract: contract,
    integration_state: resolveIntegrationState(stageId),
    integration_state_label: actionStateLabel(stageId),
  };
}

function validateStageAdvance(journey, stageTo, options = {}) {
  const norm = normalizeStageId(stageTo);
  if (!isValidStageId(norm)) {
    return { ok: false, error: `Invalid stage: ${stageTo}` };
  }
  if (options.skipGates) return { ok: true, stage: norm };

  if (norm !== 'pre_registration' && !journey.patient_id && !options.allowNoPatient) {
    return { ok: false, error: 'patient_id is required before leaving pre-registration', code: 'gate_patient_required' };
  }

  const needsAppointment = ['charge_capture', 'prior_authorization', 'medical_coding', 'cdi'];
  if (needsAppointment.includes(norm) && !journey.appointment_id && !options.allowNoAppointment) {
    return { ok: false, error: 'appointment_id is required for this stage', code: 'gate_appointment_required' };
  }

  const needsClaim = ['medical_coding', 'cdi', 'claim_submission', 'remittance_processing'];
  if (needsClaim.includes(norm) && !journey.claim_id && !options.allowNoClaim) {
    return { ok: false, error: 'claim_id is required for this stage', code: 'gate_claim_required' };
  }

  if (norm === 'registration' && journey.patient_id) {
    try {
      const elig = db.db
        .prepare(
          `SELECT id FROM eligibility_checks WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(String(journey.patient_id));
      if (!elig && !options.allowNoEligibility) {
        return { ok: false, error: 'eligibility check required before registration complete', code: 'gate_eligibility_required' };
      }
    } catch (_) {
      /* table may not exist in minimal test db */
    }
  }

  return { ok: true, stage: norm };
}

function appendEvent({ journeyId, clinicId, eventType, stageFrom, stageTo, payload, dedupeKey }) {
  ensureKellyRcmTables();
  const key = dedupeKey || buildDedupeKey(eventType, stageTo, payload);
  if (key) {
    const existing = db.db
      .prepare(`SELECT id FROM rcm_journey_events WHERE journey_id = ? AND dedupe_key = ?`)
      .get(journeyId, key);
    if (existing) {
      return { id: existing.id, deduped: true };
    }
  }
  const eventId = newId('evt');
  db.db
    .prepare(
      `INSERT INTO rcm_journey_events (id, journey_id, clinic_id, event_type, stage_from, stage_to, payload_json, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eventId,
      journeyId,
      clinicId,
      eventType,
      stageFrom || null,
      stageTo || null,
      JSON.stringify(payload || {}),
      key || null
    );
  return { id: eventId, deduped: false };
}

function findOpenJourneyByCallId(clinicId, callId) {
  if (!callId) return null;
  ensureKellyRcmTables();
  return db.db
    .prepare(
      `SELECT * FROM rcm_journeys WHERE clinic_id = ? AND call_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`
    )
    .get(String(clinicId), String(callId));
}

function findOpenJourneyForPatient(clinicId, patientId) {
  if (!patientId) return null;
  ensureKellyRcmTables();
  return db.db
    .prepare(
      `SELECT * FROM rcm_journeys WHERE clinic_id = ? AND patient_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`
    )
    .get(String(clinicId), String(patientId));
}

function startJourney({
  clinicId,
  patientId = null,
  appointmentId = null,
  claimId = null,
  callId = null,
  source = 'voice',
  stage = 'pre_registration',
  payload = {},
  intakeJson = null,
  skipGates = false,
}) {
  ensureKellyRcmTables();
  const clinic = String(clinicId).trim();
  if (!clinic) throw new Error('clinic_id is required');

  if (callId) {
    const existing = findOpenJourneyByCallId(clinic, callId);
    if (existing) return { journey: enrichJourney(existing), created: false };
  }

  const stageNorm = normalizeStageId(stage);
  if (!isValidStageId(stageNorm)) throw new Error(`Invalid stage: ${stage}`);

  if (!skipGates && stageNorm !== 'pre_registration') {
    const probe = { patient_id: patientId, appointment_id: appointmentId, claim_id: claimId, stage: 'pre_registration' };
    const gate = validateStageAdvance(probe, stageNorm, {
      allowNoPatient: !patientId && stageNorm === 'pre_registration',
      allowNoAppointment: !appointmentId,
      allowNoClaim: !claimId,
      allowNoEligibility: true,
    });
    if (!gate.ok) {
      const err = new Error(gate.error);
      err.code = gate.code || 'gate_failed';
      throw err;
    }
  }

  const id = newId('jrn');
  const initialPayload = {
    ...payload,
    integration_state: resolveIntegrationState(stageNorm),
    fallback_mode: source === 'manual_ui' ? 'manual_ui' : null,
  };

  db.db
    .prepare(
      `INSERT INTO rcm_journeys (id, clinic_id, patient_id, appointment_id, claim_id, call_id, source, stage, intake_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      clinic,
      patientId || null,
      appointmentId || null,
      claimId || null,
      callId || null,
      source,
      stageNorm,
      intakeJson ? JSON.stringify(intakeJson) : null
    );

  appendEvent({
    journeyId: id,
    clinicId: clinic,
    eventType: 'journey_started',
    stageTo: stageNorm,
    payload: initialPayload,
    dedupeKey: `journey_started:${stageNorm}`,
  });

  const journey = getJourney(clinic, id);
  if (patientId) {
    try {
      syncCopayFromEligibility({ clinicId: clinic, patientId, journeyId: id });
    } catch (_) {}
  }
  return { journey: enrichJourney(journey), created: true, journey_id: id };
}

/** TODO-11: copy latest eligibility copay onto journey events for Kelly/RCM UI. */
function syncCopayFromEligibility({ clinicId, patientId, journeyId }) {
  if (!patientId || !journeyId || !clinicId) return null;
  ensureKellyRcmTables();
  const row = db.db
    .prepare(
      `SELECT copay_amount, eligible, payer_id FROM eligibility_checks
       WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(String(patientId));
  if (!row || row.copay_amount == null) return null;
  appendEvent({
    journeyId,
    clinicId,
    eventType: 'eligibility_copay_normalized',
    stageTo: null,
    payload: {
      copay_amount: row.copay_amount,
      eligible: row.eligible,
      payer_id: row.payer_id || null,
    },
    dedupeKey: `eligibility_copay:${patientId}:${row.copay_amount}`,
  });
  return row.copay_amount;
}

function advanceStage({
  journeyId,
  clinicId,
  stageTo,
  stageFrom = null,
  eventType = 'stage_transition',
  payload = {},
  options = {},
}) {
  ensureKellyRcmTables();
  const journey = getJourney(clinicId, journeyId);
  if (!journey) throw new Error('Journey not found');

  const gate = validateStageAdvance(journey, stageTo, options);
  if (!gate.ok) {
    const err = new Error(gate.error);
    err.code = gate.code || 'gate_failed';
    throw err;
  }

  const fromNorm = stageFrom ? normalizeStageId(stageFrom) : normalizeStageId(journey.stage);
  const toNorm = gate.stage;
  const payloadWithState = {
    ...payload,
    integration_state: resolveIntegrationState(toNorm),
    mode: payload.mode || options.mode || 'agent_available',
  };

  appendEvent({
    journeyId,
    clinicId,
    eventType,
    stageFrom: fromNorm,
    stageTo: toNorm,
    payload: payloadWithState,
    dedupeKey: options.dedupeKey || `${eventType}:${toNorm}:${buildDedupeKey(eventType, toNorm, payload).slice(0, 8)}`,
  });

  db.db
    .prepare(`UPDATE rcm_journeys SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND clinic_id = ?`)
    .run(toNorm, journeyId, clinicId);

  return { journey_id: journeyId, stage: toNorm, integration_state: resolveIntegrationState(toNorm) };
}

function recordAgentAction({ journeyId, clinicId, stageTo, actionType = 'agent_follow_up', payload = {}, options = {} }) {
  return advanceStage({
    journeyId,
    clinicId,
    stageTo: stageTo || 'follow_up_phone',
    eventType: actionType,
    payload: { ...payload, actor: 'kelly_agent', mode: 'agent_available' },
    options: { ...options, mode: 'agent_available', skipGates: options.skipGates ?? true },
  });
}

function patchJourney(clinicId, journeyId, updates = {}) {
  ensureKellyRcmTables();
  const journey = getJourney(clinicId, journeyId);
  if (!journey) throw new Error('Journey not found');

  const fields = [];
  const values = [];
  if (updates.status != null) {
    fields.push('status = ?');
    values.push(String(updates.status));
  }
  if (updates.amount_due != null) {
    fields.push('amount_due = ?');
    values.push(Number(updates.amount_due));
  }
  if (updates.patient_id != null) {
    fields.push('patient_id = ?');
    values.push(updates.patient_id || null);
  }
  if (updates.appointment_id != null) {
    fields.push('appointment_id = ?');
    values.push(updates.appointment_id || null);
  }
  if (updates.claim_id != null) {
    fields.push('claim_id = ?');
    values.push(updates.claim_id || null);
  }
  if (updates.intake_json != null) {
    fields.push('intake_json = ?');
    values.push(typeof updates.intake_json === 'string' ? updates.intake_json : JSON.stringify(updates.intake_json));
  }
  if (!fields.length) return enrichJourney(journey);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(journeyId, clinicId);
  db.db.prepare(`UPDATE rcm_journeys SET ${fields.join(', ')} WHERE id = ? AND clinic_id = ?`).run(...values);
  return enrichJourney(getJourney(clinicId, journeyId));
}

function linkClaimToJourney(clinicId, journeyId, claimId) {
  return patchJourney(clinicId, journeyId, { claim_id: claimId });
}

function listJourneys(clinicId, { limit = 20, patientId, appointmentId, status, callId } = {}) {
  ensureKellyRcmTables();
  const clauses = ['clinic_id = ?'];
  const params = [String(clinicId)];
  if (patientId) {
    clauses.push('patient_id = ?');
    params.push(String(patientId));
  }
  if (appointmentId) {
    clauses.push('appointment_id = ?');
    params.push(String(appointmentId));
  }
  if (status) {
    clauses.push('status = ?');
    params.push(String(status));
  }
  if (callId) {
    clauses.push('call_id = ?');
    params.push(String(callId));
  }
  const lim = Math.min(parseInt(String(limit), 10) || 20, 100);
  params.push(lim);
  const rows = db.db
    .prepare(`SELECT * FROM rcm_journeys WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...params);
  return rows.map((r) => enrichJourney(r));
}

function captureIntakeFromCall({ clinicId, callId, intakePayload = {}, patientId = null }) {
  const existing = findOpenJourneyByCallId(clinicId, callId);
  if (!existing) {
    return startJourney({
      clinicId,
      callId,
      patientId,
      source: 'voice',
      stage: 'pre_registration',
      intakeJson: intakePayload,
      payload: { event: 'intake_captured' },
    });
  }
  patchJourney(clinicId, existing.id, {
    intake_json: intakePayload,
    patient_id: patientId || existing.patient_id,
  });
  appendEvent({
    journeyId: existing.id,
    clinicId,
    eventType: 'intake_captured',
    stageTo: normalizeStageId(existing.stage),
    payload: intakePayload,
    dedupeKey: `intake_captured:${callId}`,
  });
  return { journey: enrichJourney(getJourney(clinicId, existing.id)), created: false };
}

function onClaimAdjudication({ clinicId, claimId, status, payload = {} }) {
  ensureKellyRcmTables();
  let journey = db.db
    .prepare(`SELECT * FROM rcm_journeys WHERE clinic_id = ? AND claim_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`)
    .get(String(clinicId), String(claimId));
  if (!journey) return null;

  const denied = String(status || '').toLowerCase() === 'denied';
  const stageTo = denied ? 'claim_submission' : journey.stage;
  appendEvent({
    journeyId: journey.id,
    clinicId,
    eventType: denied ? 'claim_denied' : 'claim_adjudicated',
    stageFrom: normalizeStageId(journey.stage),
    stageTo: denied ? 'claim_submission' : normalizeStageId(journey.stage),
    payload: { claim_id: claimId, status, ...payload },
    dedupeKey: `adjudication:${claimId}:${status}`,
  });
  if (denied) {
    db.db
      .prepare(`UPDATE rcm_journeys SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run('claim_submission', journey.id);
  }
  return enrichJourney(getJourney(clinicId, journey.id));
}

function confirmIntake({ clinicId, journeyId, intake = {}, patientId = null }) {
  const journey = getJourney(clinicId, journeyId);
  if (!journey) throw new Error('Journey not found');
  const merged = { ...(safeJsonParse(journey.intake_json) || {}), ...intake };
  const pid = patientId || journey.patient_id;
  if (!pid) {
    const err = new Error('patient_id is required to confirm intake');
    err.code = 'gate_patient_required';
    throw err;
  }
  patchJourney(clinicId, journeyId, { intake_json: merged, patient_id: pid });
  return advanceStage({
    journeyId,
    clinicId,
    stageTo: 'registration',
    stageFrom: 'pre_registration',
    eventType: 'intake_confirmed',
    payload: { intake: merged, patient_id: pid },
    options: { allowNoEligibility: true },
  });
}

function listFollowUpQueue(clinicId, { days = 30, limit = 50 } = {}) {
  ensureKellyRcmTables();
  const thresholdDays = Math.max(1, parseInt(String(days), 10) || 30);
  try {
    const rows = db.db
      .prepare(
        `SELECT c.id AS claim_id, c.status, c.submitted_at, c.x12_claim_id, c.appointment_id,
                a.patient_id, a.clinic_id, j.id AS journey_id, j.stage
         FROM insurance_claims c
         JOIN appointments a ON c.appointment_id = a.id
         LEFT JOIN rcm_journeys j ON j.claim_id = c.id AND j.clinic_id = a.clinic_id AND j.status = 'open'
         WHERE a.clinic_id = ?
           AND c.status IN ('submitted', 'pending')
           AND c.submitted_at IS NOT NULL
           AND datetime(c.submitted_at) <= datetime('now', '-' || ? || ' days')
         ORDER BY c.submitted_at ASC
         LIMIT ?`
      )
      .all(String(clinicId), thresholdDays, Math.min(limit, 100));
    return rows.map((r) => ({
      ...r,
      script_draft: `Call payer re: claim ${r.x12_claim_id || r.claim_id}, submitted ${(r.submitted_at || '').slice(0, 10)}, status unknown.`,
    }));
  } catch (_) {
    return [];
  }
}

function postLedgerPair({ clinicId, journeyId, payerAmount, patientAmount, note }) {
  ensureKellyRcmTables();
  if (payerAmount > 0) {
    db.db
      .prepare(
        `INSERT INTO rcm_ledger_entries (id, clinic_id, journey_id, direction, amount, category, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newId('led'), clinicId, journeyId, 'incoming', payerAmount, 'payer_payment', note || 'Payer remittance');
  }
  if (patientAmount > 0) {
    db.db
      .prepare(
        `INSERT INTO rcm_ledger_entries (id, clinic_id, journey_id, direction, amount, category, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newId('led'), clinicId, journeyId, 'incoming', patientAmount, 'patient_responsibility', 'Patient balance from remittance');
    db.db
      .prepare(`UPDATE rcm_journeys SET amount_due = COALESCE(amount_due, 0) + ? WHERE id = ? AND clinic_id = ?`)
      .run(patientAmount, journeyId, clinicId);
  }
}

function onRemittancePosted({ clinicId, claimId, amount, payload = {} }) {
  ensureKellyRcmTables();
  let journey = db.db
    .prepare(`SELECT * FROM rcm_journeys WHERE clinic_id = ? AND claim_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(String(clinicId), String(claimId));
  if (!journey) return null;

  const patientResp = Number(payload.patient_responsibility || payload.patient_balance || 0);
  const allowed = Number(payload.allowed_amount || amount || 0);
  const underpaid = allowed > 0 && amount > 0 && amount < allowed * 0.95;
  postLedgerPair({
    clinicId,
    journeyId: journey.id,
    payerAmount: amount,
    patientAmount: patientResp,
    note: `Remittance for claim ${claimId}`,
  });
  if (underpaid) {
    appendEvent({
      journeyId: journey.id,
      clinicId,
      eventType: 'underpayment_flagged',
      stageTo: 'remittance_processing',
      payload: { claim_id: claimId, paid: amount, allowed, action: 'appeal_or_write_off' },
      dedupeKey: `underpay:${claimId}`,
    });
  }

  try {
    advanceStage({
      journeyId: journey.id,
      clinicId,
      stageTo: 'remittance_processing',
      eventType: 'remittance_posted',
      payload: { claim_id: claimId, amount, patient_responsibility: patientResp, underpaid, ...payload },
      options: { skipGates: true, dedupeKey: `remittance:${claimId}` },
    });
  } catch (_) {
    appendEvent({
      journeyId: journey.id,
      clinicId,
      eventType: 'remittance_posted',
      stageTo: 'remittance_processing',
      payload: { claim_id: claimId, amount, ...payload },
      dedupeKey: `remittance:${claimId}`,
    });
    db.db
      .prepare(`UPDATE rcm_journeys SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run('remittance_processing', journey.id);
  }
  return enrichJourney(getJourney(clinicId, journey.id));
}

/** P3 stub — health session copay paid (Circle/RCM journey hook). */
async function recordHealthSessionCopayStub(sessionId, routingRow) {
  ensureKellyRcmTables();
  const journeyId = `hsj_${String(sessionId || '').slice(0, 8)}`;
  const amount = routingRow?.copay_cents ? routingRow.copay_cents / 100 : 0;
  try {
    db.db.prepare(`
      INSERT OR IGNORE INTO rcm_journeys (id, clinic_id, patient_id, source, stage, status, amount_due, metadata_json, created_at, updated_at)
      VALUES (?, 'health-consumer', NULL, 'health_video', 'copay_collected', 'open', ?, ?, datetime('now'), datetime('now'))
    `).run(
      journeyId,
      amount,
      JSON.stringify({ health_session_id: sessionId, stub: true, copay_cents: routingRow?.copay_cents || null })
    );
  } catch (e) {
    console.warn('[RCM] health session copay stub (non-fatal):', e.message);
  }
  return { journey_id: journeyId, amount_due: amount };
}

module.exports = {
  RCM_STAGE_CONTRACT,
  appendEvent,
  ensureKellyRcmTables,
  normalizeStageId,
  isValidStageId,
  stageContractMap,
  resolveIntegrationState,
  actionStateLabel,
  getJourney,
  enrichJourney,
  validateStageAdvance,
  startJourney,
  advanceStage,
  recordAgentAction,
  patchJourney,
  linkClaimToJourney,
  listJourneys,
  findOpenJourneyByCallId,
  findOpenJourneyForPatient,
  captureIntakeFromCall,
  confirmIntake,
  listFollowUpQueue,
  postLedgerPair,
  onClaimAdjudication,
  onRemittancePosted,
  safeJsonParse,
  syncCopayFromEligibility,
  recordHealthSessionCopayStub,
};
