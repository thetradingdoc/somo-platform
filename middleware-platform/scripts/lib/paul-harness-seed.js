'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * HARNESS_ONLY — Seed validated triage row for Paul harness (fast, no live Pinecone).
 * Excluded from capture:coding-prod-evidence; use live RAG in terminal-coding-call.cjs.
 */
function seedPaulTriage(db, sessionId, patientId = 'patient_paul') {
  try {
    require('../migrations/081_seeded_for_harness').up(db.db);
  } catch (_) {}
  const primaryIcd10 = 'K29.70';
  const primaryCpt = '99213';
  const ragId = uuidv4();
  const intakeAt = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, patient_id, symptom_text, opqrst_json,
      icd_codes, cpt_codes, target_specialty, urgency, safety_level,
      rag_confidence, primary_icd10, primary_cpt, seeded_for_harness, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(
    ragId,
    sessionId,
    patientId,
    'stomach pain since yesterday with nausea after meals',
    JSON.stringify({ onset: 'yesterday', quality: 'cramping', severity: 6 }),
    JSON.stringify([{ code: primaryIcd10, description: 'Gastritis' }]),
    JSON.stringify([{ code: primaryCpt, description: 'Office visit' }]),
    'Gastroenterology',
    'routine',
    'green',
    0.85,
    primaryIcd10,
    primaryCpt
  );

  db.upsertTriageSession({
    session_id: sessionId,
    clinic_id: 'clinic-default',
    triage_complete: 1,
    opqrst_complete: 1,
    intake_complete_at: intakeAt,
    target_specialty: 'Gastroenterology',
    rag_result_id: ragId
  });

  return {
    id: ragId,
    primary_icd10: primaryIcd10,
    primary_cpt: primaryCpt,
    rag_confidence: 0.85,
    target_specialty: 'Gastroenterology',
    cpt_codes: [{ code: primaryCpt }]
  };
}

module.exports = { seedPaulTriage };
