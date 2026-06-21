'use strict';

/**
 * Human-in-the-loop coding review queue (front-desk / voice spine).
 */

const { v4: uuidv4 } = require('uuid');
const dbMod = require('../database');
const knowledgeService = require('./knowledge-service');
const { CODING_HITL_APPROVED_CONFIDENCE } = require('../config/coding-thresholds');

const SLA_MS = parseInt(process.env.CODING_HITL_SLA_MS || '120000', 10);

function flagForReview({
  sessionId,
  clinicId = null,
  patientId = null,
  proposed_icd10 = '',
  proposed_cpt = '',
  confidence = 0,
  reason = 'coding_review_required',
  clinical_note = null,
  assignee_id = null
}) {
  if (!sessionId) throw new Error('sessionId required');
  const sqlite = dbMod.db?.db || dbMod.db;
  if (sqlite) {
    const existing = sqlite.prepare(`
      SELECT id FROM coding_decisions
      WHERE call_id = ? AND validation_status = 'needs_review'
        AND proposed_icd10 = ? AND proposed_cpt = ? AND validation_reason = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(sessionId, proposed_icd10 || '', proposed_cpt || '', reason);
    if (existing?.id) return existing;
  }
  const slaDeadline = new Date(Date.now() + SLA_MS).toISOString();
  const row = {
    call_id: sessionId,
    clinic_id: clinicId,
    patient_id: patientId,
    clinical_note: clinical_note,
    proposed_icd10: proposed_icd10 || '',
    proposed_cpt: proposed_cpt || '',
    reasoning: reason,
    confidence_score: confidence,
    validation_status: 'needs_review',
    validation_reason: reason,
    assignee_id,
    sla_deadline: slaDeadline
  };
  const inserted = dbMod.insertCodingDecision?.(row);
  try {
    dbMod.insertKellyCallEvent?.({
      session_id: sessionId,
      event_type: 'coding_hitl_required',
      payload_json: JSON.stringify({
        at: new Date().toISOString(),
        reason,
        proposed_icd10,
        proposed_cpt,
        confidence,
        sla_deadline: slaDeadline
      })
    });
  } catch (_) {}
  return inserted || row;
}

function listPending({ clinicId = null, limit = 50 } = {}) {
  const sqlite = dbMod.db?.db || dbMod.db;
  if (!sqlite) return [];
  let sql = `SELECT * FROM coding_decisions WHERE validation_status = 'needs_review'`;
  const params = [];
  if (clinicId) {
    sql += ' AND clinic_id = ?';
    params.push(clinicId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return sqlite.prepare(sql).all(...params);
}

function getById(id) {
  const sqlite = dbMod.db?.db || dbMod.db;
  return sqlite?.prepare('SELECT * FROM coding_decisions WHERE id = ?').get(id) || null;
}

function _setResumeMeta(sessionId, icd, cptCode) {
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_pending', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_icd', icd || '');
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_cpt', cptCode || '');
    KellyToolExecutor._setSessionMeta(sessionId, 'coding_hitl_resume_at_ms', String(Date.now()));
  } catch (_) {}
}

function _resumeSessionAfterApproval(sessionId, reviewId, icd, cptCode, resolved_by) {
  _setResumeMeta(sessionId, icd, cptCode);
  try {
    dbMod.insertKellyCallEvent?.({
      session_id: sessionId,
      event_type: 'coding_hitl_resumed',
      payload_json: JSON.stringify({
        at: new Date().toISOString(),
        review_id: reviewId,
        primary_icd10: icd,
        primary_cpt: cptCode,
        resolved_by,
        action: 'retry_collect_insurance'
      })
    });
  } catch (_) {}
}

function approveReview(id, { icd10, cpt, resolved_by = null, sessionId = null }) {
  const sqlite = dbMod.db?.db || dbMod.db;
  const row = getById(id);
  if (!row) throw new Error('review not found');
  const icd = icd10 || row.proposed_icd10;
  const cptCode = cpt || row.proposed_cpt;
  const sid = sessionId || row.call_id;

  const pairCheck = knowledgeService.validateCodePair(icd, cptCode);
  if (!pairCheck.valid) {
    throw new Error(`Invalid code pair: ${pairCheck.reason || 'incompatible ICD/CPT'}`);
  }

  sqlite.prepare(`
    UPDATE coding_decisions
    SET validation_status = 'approved', validation_reason = ?, proposed_icd10 = ?, proposed_cpt = ?
    WHERE id = ?
  `).run(`approved_by:${resolved_by || 'admin'}`, icd, cptCode, id);

  if (sid) {
    try {
      const rag = sqlite.prepare(
        'SELECT id FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(sid);
      if (rag?.id) {
        sqlite.prepare(
          'UPDATE triage_rag_results SET primary_icd10 = ?, primary_cpt = ?, rag_confidence = ? WHERE id = ?'
        ).run(icd, cptCode, CODING_HITL_APPROVED_CONFIDENCE, rag.id);
      }
    } catch (_) {}
    try {
      dbMod.insertKellyCallEvent?.({
        session_id: sid,
        event_type: 'coding_hitl_approved',
        payload_json: JSON.stringify({
          at: new Date().toISOString(),
          review_id: id,
          primary_icd10: icd,
          primary_cpt: cptCode,
          resolved_by
        })
      });
    } catch (_) {}
    _resumeSessionAfterApproval(sid, id, icd, cptCode, resolved_by);
  }

  return getById(id);
}

function rejectReview(id, { rejection_reason = 'rejected', resolved_by = null, sessionId = null } = {}) {
  const sqlite = dbMod.db?.db || dbMod.db;
  const row = getById(id);
  if (!row) throw new Error('review not found');
  const sid = sessionId || row.call_id;

  sqlite.prepare(`
    UPDATE coding_decisions
    SET validation_status = 'rejected', validation_reason = ?, rejection_reason = ?
    WHERE id = ?
  `).run(`rejected_by:${resolved_by || 'admin'}`, rejection_reason, id);

  if (sid) {
    try {
      const { clearCodingHitlResumeMeta } = require('./coding-hitl-resume');
      clearCodingHitlResumeMeta(sid);
    } catch (_) {}
    try {
      dbMod.insertKellyCallEvent?.({
        session_id: sid,
        event_type: 'coding_hitl_rejected',
        payload_json: JSON.stringify({
          at: new Date().toISOString(),
          review_id: id,
          rejection_reason,
          resolved_by
        })
      });
    } catch (_) {}
  }

  return getById(id);
}

function checkSlaBreaches({ limit = 50 } = {}) {
  const sqlite = dbMod.db?.db || dbMod.db;
  if (!sqlite) return [];
  const now = new Date().toISOString();
  const rows = sqlite.prepare(`
    SELECT * FROM coding_decisions
    WHERE validation_status = 'needs_review'
      AND sla_deadline IS NOT NULL
      AND sla_deadline < ?
    ORDER BY sla_deadline ASC
    LIMIT ?
  `).all(now, limit);
  for (const row of rows) {
    try {
      dbMod.insertKellyCallEvent?.({
        session_id: row.call_id,
        event_type: 'HITL_SLA_BREACH',
        payload_json: JSON.stringify({
          at: now,
          review_id: row.id,
          sla_deadline: row.sla_deadline
        })
      });
    } catch (_) {}
  }
  return rows;
}

module.exports = {
  flagForReview,
  listPending,
  getById,
  approveReview,
  rejectReview,
  checkSlaBreaches
};
