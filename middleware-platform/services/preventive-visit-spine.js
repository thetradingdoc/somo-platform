'use strict';

/**
 * Lightweight preventive / wellness visit coding spine (routine no-symptoms path).
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const knowledgeService = require('./knowledge-service');
const { CODING_CONFIDENCE_THRESHOLD, CODING_HITL_APPROVED_CONFIDENCE } = require('../config/coding-thresholds');

const PREVENTIVE_ICD_NEW = 'Z00.00';
const PREVENTIVE_ICD_EST = 'Z00.01';
const PREVENTIVE_CPT_NEW = '99385';
const PREVENTIVE_CPT_EST = '99395';

function isPreventiveIcd(code) {
  const c = String(code || '').trim().toUpperCase().replace(/\./g, '');
  return c.startsWith('Z00') || c.startsWith('Z23') || c.startsWith('Z12');
}

async function ensurePreventiveSpine({ sessionId, patientId, clinicId, isNewPatient = true }) {
  if (!sessionId) throw new Error('sessionId required');

  const existing = db.db.prepare(
    'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);
  if (existing?.primary_icd10 && isPreventiveIcd(existing.primary_icd10) && existing.primary_cpt) {
    return {
      primary_icd10: existing.primary_icd10,
      primary_cpt: existing.primary_cpt,
      rag_confidence: parseFloat(existing.rag_confidence) || CODING_CONFIDENCE_THRESHOLD,
      code_source: 'spine',
      rag_id: existing.id
    };
  }

  let primaryIcd10 = isNewPatient ? PREVENTIVE_ICD_NEW : PREVENTIVE_ICD_EST;
  let primaryCpt = isNewPatient ? PREVENTIVE_CPT_NEW : PREVENTIVE_CPT_EST;
  let ragConfidence = CODING_HITL_APPROVED_CONFIDENCE;
  let remoteSource = 'preventive_spine';

  const useV2 = process.env.USE_TRIAGE_RAG_V2 === '1' || process.env.USE_TRIAGE_RAG_V2 === 'true';
  if (useV2) {
    try {
      const TriageRAGServiceV2 = require('./triage-rag-service-v2');
      const out = await TriageRAGServiceV2.enrichFromSymptoms({
        sessionId,
        patientId,
        clinicId,
        symptomText: 'annual wellness checkup preventive visit no active symptoms',
        opqrst: { quality: 'routine wellness', onset: 'n/a', severity: 0 },
        richIntake: {}
      });
      if (out?.primary_icd10 && isPreventiveIcd(out.primary_icd10)) {
        primaryIcd10 = out.primary_icd10;
        primaryCpt = out.primary_cpt || primaryCpt;
        ragConfidence = out.rag_confidence ?? ragConfidence;
        remoteSource = out.coding_provenance_json
          ? JSON.parse(out.coding_provenance_json || '{}').remote_source || 'dual_source'
          : 'dual_source';
      }
    } catch (e) {
      console.warn('[preventive-visit-spine] v2 enrich failed, using SQLite preventive defaults:', e.message);
    }
  }

  const validation = knowledgeService.validateCodesExist({
    icd10: [primaryIcd10],
    cpt: [primaryCpt]
  });
  if (!validation.valid) {
    return { hitl_required: true, reason: 'invalid_preventive_codes', invalid: validation.invalid };
  }

  if (ragConfidence < CODING_CONFIDENCE_THRESHOLD) {
    return {
      hitl_required: true,
      reason: 'low_confidence',
      proposed_icd10: primaryIcd10,
      proposed_cpt: primaryCpt,
      confidence: ragConfidence
    };
  }

  const ragId = existing?.id || uuidv4();
  const provenance = JSON.stringify({
    remote_source: remoteSource,
    code_source: 'spine',
    visit_type: 'preventive',
    code_pair_valid: knowledgeService.validateCodePair(primaryIcd10, primaryCpt).valid
  });

  if (existing?.id) {
    db.db.prepare(`
      UPDATE triage_rag_results SET
        primary_icd10 = ?, primary_cpt = ?, rag_confidence = ?,
        target_specialty = ?, urgency = ?, coding_provenance_json = ?
      WHERE id = ?
    `).run(primaryIcd10, primaryCpt, ragConfidence, 'PrimaryCare', 'routine', provenance, ragId);
  } else {
    db.db.prepare(`
      INSERT INTO triage_rag_results (
        id, session_id, patient_id, symptom_text, target_specialty, urgency,
        rag_confidence, primary_icd10, primary_cpt, coding_provenance_json,
        icd_codes, cpt_codes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      ragId, sessionId, patientId || null,
      'annual wellness checkup preventive visit',
      'PrimaryCare', 'routine', ragConfidence,
      primaryIcd10, primaryCpt, provenance,
      JSON.stringify([{ code: primaryIcd10 }]),
      JSON.stringify([{ code: primaryCpt }])
    );
  }

  db.upsertTriageSession({
    session_id: sessionId,
    patient_id: patientId || null,
    rag_result_id: ragId,
    target_specialty: 'PrimaryCare',
    triage_complete: 1,
    opqrst_complete: 1,
    intake_complete_at: new Date().toISOString(),
    urgency: 'routine',
    safety_level: 'green'
  });

  return {
    primary_icd10: primaryIcd10,
    primary_cpt: primaryCpt,
    rag_confidence: ragConfidence,
    code_source: 'spine',
    rag_id: ragId
  };
}

module.exports = {
  ensurePreventiveSpine,
  isPreventiveIcd,
  PREVENTIVE_ICD_NEW,
  PREVENTIVE_ICD_EST
};
