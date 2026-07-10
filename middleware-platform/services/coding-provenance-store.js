'use strict';

/**
 * Persist coding provenance on admin / spine resolve paths (F-08).
 */

function persistCodingProvenanceRow(sessionId, payload = {}, opts = {}) {
  if (!sessionId) return;
  try {
    const db = require('../database');
    if (!db.db) return;
    try {
      require('../migrations/082_coding_provenance_json').up(db.db);
    } catch (_) {}

    const provenanceJson = JSON.stringify({
      ...payload,
      persisted_at: new Date().toISOString(),
      channel: opts.channel || 'spine'
    });
    const primaryIcd10 = payload.primary_icd10 || null;
    const primaryCpt = payload.primary_cpt || null;
    const confidence = payload.rag_confidence != null ? payload.rag_confidence : 1;
    const existing = db.db
      .prepare(
        `SELECT id FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(sessionId);

    if (existing?.id) {
      db.db
        .prepare(
          `UPDATE triage_rag_results SET
            primary_icd10 = COALESCE(?, primary_icd10),
            primary_cpt = COALESCE(?, primary_cpt),
            rag_confidence = COALESCE(?, rag_confidence),
            coding_provenance_json = ?
          WHERE id = ?`
        )
        .run(primaryIcd10, primaryCpt, confidence, provenanceJson, existing.id);
      return existing.id;
    }

    const id = `prov_${sessionId}_${Date.now()}`;
    db.db
      .prepare(
        `INSERT INTO triage_rag_results (
          id, session_id, symptom_text, target_specialty, urgency, rag_confidence,
          primary_icd10, primary_cpt, coding_provenance_json, icd_codes, cpt_codes, created_at
        ) VALUES (?, ?, ?, ?, 'routine', ?, ?, ?, ?, '[]', '[]', datetime('now'))`
      )
      .run(
        id,
        sessionId,
        opts.symptomText || 'admin_resolve',
        opts.targetSpecialty || 'Dental',
        confidence,
        primaryIcd10,
        primaryCpt,
        provenanceJson
      );
    return id;
  } catch (e) {
    console.warn('[coding-provenance-store] persist failed:', e.message);
    return null;
  }
}

function logCodingProvenanceEvent(sessionId, payload = {}, opts = {}) {
  try {
    const db = require('../database');
    db.insertKellyCallEvent?.({
      session_id: sessionId,
      call_id: opts.callId || sessionId,
      event_type: 'coding_provenance',
      payload_json: { ...payload, channel: opts.channel || 'http_spine' },
      clinic_id: opts.clinicId || null
    });
  } catch (_) {}
}

module.exports = { persistCodingProvenanceRow, logCodingProvenanceEvent };
