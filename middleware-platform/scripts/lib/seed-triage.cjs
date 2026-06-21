'use strict';

function seedTriage(db, sessionId, opts = {}) {
  const icd = opts.icd || 'K29.70';
  const cpt = opts.cpt || '99213';
  const confidence = opts.confidence != null ? opts.confidence : 0.85;
  const harness = opts.harness ? 1 : 0;
  const ragId = opts.ragId || `seed_${sessionId}`;

  db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, symptom_text, target_specialty, urgency, rag_confidence,
      primary_icd10, primary_cpt, seeded_for_harness, icd_codes, cpt_codes, created_at
    ) VALUES (?, ?, ?, ?, 'routine', ?, ?, ?, ?, '[]', '[]', datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      session_id=excluded.session_id,
      primary_icd10=excluded.primary_icd10,
      primary_cpt=excluded.primary_cpt,
      rag_confidence=excluded.rag_confidence,
      seeded_for_harness=excluded.seeded_for_harness
  `).run(
    ragId,
    sessionId,
    opts.symptomText || 'test',
    opts.specialty || 'Gastroenterology',
    confidence,
    icd,
    cpt,
    harness
  );

  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='triage_sessions'").get()) {
    db.prepare(`
      INSERT OR REPLACE INTO triage_sessions (
        session_id, rag_result_id, triage_complete, opqrst_complete, intake_complete_at
      ) VALUES (?, ?, 1, 1, datetime('now'))
    `).run(sessionId, ragId);
  }

  return { ragId, icd, cpt, confidence, harness };
}

module.exports = { seedTriage };
