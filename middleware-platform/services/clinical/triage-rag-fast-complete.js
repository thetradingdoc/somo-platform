'use strict';

const crypto = require('crypto');
const db = require('../../database');
const KellyToolExecutor = require('../kelly/kelly-tool-executor');
const TriageRAGService = require('./triage-rag-service');

/**
 * Persist a routine dermatology RAG row when OPQRST is already on the session.
 * TEST-ONLY: requires NODE_ENV=test and KELLY_RAILS_FAST_RAG=1.
 */
function fastRagAllowed() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'test'
    && String(process.env.KELLY_RAILS_FAST_RAG || '').trim() === '1';
}

function completeTriageRagForSession(sessionId, patientId, opts = {}) {
  if (!fastRagAllowed()) {
    throw new Error(
      'completeTriageRagForSession is test-only (NODE_ENV=test and KELLY_RAILS_FAST_RAG=1)'
    );
  }
  if (!sessionId) throw new Error('completeTriageRagForSession requires sessionId');

  const row = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  if (row?.rag_result_id && TriageRAGService.getLatestForSession(sessionId)) {
    return { ragId: row.rag_result_id, alreadyComplete: true };
  }

  const targetSpecialty = opts.targetSpecialty || row?.target_specialty || 'Dermatology';
  const region = opts.region || row?.region || row?.body_site || 'leg and neck';
  const quality = opts.quality || row?.quality || 'itchy rash on leg and neck';
  const ragId = opts.ragId || `rag_fast_${crypto.randomBytes(8).toString('hex')}`;
  const nowIso = new Date().toISOString();

  try {
    const cols = new Set(db.db.prepare(`PRAGMA table_info(triage_rag_results)`).all().map((c) => c.name));
    const ragPayload = {
      id: ragId,
      session_id: sessionId,
      patient_id: patientId || row?.patient_id || null,
      symptom_text: opts.symptomText || `${quality} for one week`,
      opqrst_json: JSON.stringify({ quality, onset: row?.onset || '1 week', severity: row?.severity ?? 3, region }),
      icd_codes: JSON.stringify([{ code: 'L30.9', description: 'Dermatitis' }]),
      cpt_codes: JSON.stringify(['99213']),
      target_specialty: targetSpecialty,
      secondary_specialties: JSON.stringify([targetSpecialty]),
      urgency: 'routine',
      safety_level: 'green',
      red_flags: JSON.stringify([]),
      recommended_lane: 'sync',
      patient_friendly_summary: opts.summary || `Rash on ${region} — dermatology visit`,
      specialist_context: opts.specialistContext || 'Kelly rails fast RAG',
      differentials: JSON.stringify([
        { icd10: 'L30.9', description: 'Contact dermatitis', probability: 0.7 }
      ]),
      soap_note: opts.soapNote || `Patient reports ${quality} on ${region}.`,
      rag_confidence: opts.ragConfidence ?? 0.92,
      created_at: nowIso,
    };
    const insertCols = Object.keys(ragPayload).filter((k) => cols.has(k));
    db.db
      .prepare(
        `INSERT INTO triage_rag_results (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`
      )
      .run(...insertCols.map((k) => ragPayload[k]));
  } catch (e) {
    if (!String(e.message || '').includes('UNIQUE')) {
      throw new Error(`completeTriageRagForSession: ${e.message}`);
    }
  }

  db.upsertTriageSession({
    session_id: sessionId,
    patient_id: patientId || row?.patient_id || null,
    rag_result_id: ragId,
    quality,
    onset: row?.onset || opts.onset || '1 week ago',
    severity: row?.severity ?? opts.severity ?? 3,
    provocation: row?.provocation || 'scratching',
    region,
    body_site: region,
    target_specialty: targetSpecialty,
    triage_complete: 1,
    opqrst_complete: 1,
    intake_complete_at: nowIso,
    safety_level: 'green',
    urgency: 'routine',
  });

  try {
    KellyToolExecutor._setSessionMeta(sessionId, 'routine_intake_active', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'rich_intake_complete', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_orchestrator_phase', 'TRIAGE_ACTIVE');
    if (opts.patientName) KellyToolExecutor._setSessionMeta(sessionId, 'collected_name', opts.patientName);
    if (opts.email) KellyToolExecutor._setSessionMeta(sessionId, 'collected_email', opts.email);
  } catch (_) {}

  if (!TriageRAGService.getLatestForSession(sessionId)) {
    throw new Error('completeTriageRagForSession: RAG row not readable after insert');
  }

  return { ragId, alreadyComplete: false };
}

module.exports = { completeTriageRagForSession };
