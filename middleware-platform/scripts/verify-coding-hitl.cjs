#!/usr/bin/env node
'use strict';

/**
 * Session 3 acceptance — HITL coding review queue.
 *
 * Scenario A — low confidence:
 *   collect_insurance returns CODING_REVIEW_REQUIRED
 *   coding_decisions.validation_status = needs_review
 *   NO quote_audit row
 *   listPending includes session
 *
 * Scenario B — high confidence spine path:
 *   no needs_review row; quote proceeds
 *
 * Run:
 *   CODing_SPINE_ONLY=1 DB_PATH=./var/db/middleware-dev.db node scripts/verify-coding-hitl.cjs
 * exit 0
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.CODING_SPINE_ONLY = '1';
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const dbMod = require('../database');
const db = dbMod.db;
const KellyToolExecutor = require('../services/kelly-tool-executor');
const codingReview = require('../services/coding-review-service');
const { computeVisitQuote } = require('../services/payer-quote-service');

try {
  require('../migrations/081_seeded_for_harness').up(db);
} catch (_) {}

function seedTriage(sessionId, { icd, cpt, confidence, harness = 0 }) {
  const id = `hitl_${sessionId}`;
  db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, symptom_text, target_specialty, urgency, rag_confidence,
      primary_icd10, primary_cpt, seeded_for_harness, icd_codes, cpt_codes, created_at
    ) VALUES (?, ?, 'test', 'Gastroenterology', 'routine', ?, ?, ?, ?, '[]', '[]', datetime('now'))
  `).run(id, sessionId, confidence, icd, cpt, harness);
  db.prepare(`
    INSERT OR REPLACE INTO triage_sessions (
      session_id, triage_complete, opqrst_complete, intake_complete_at, rag_result_id
    ) VALUES (?, 1, 1, datetime('now'), ?)
  `).run(sessionId, id);
}

async function scenarioLowConfidence() {
  const sessionId = `hitl_low_${Date.now()}`;
  seedTriage(sessionId, { icd: 'K29.70', cpt: '99213', confidence: 0.50 });
  const result = await KellyToolExecutor._collectInsurance(
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', date_of_birth: '1990-01-15' },
    { sessionId, patientId: 'p_hitl', callerPhone: '+15555550199' }
  );
  const review = db.prepare(
    "SELECT * FROM coding_decisions WHERE call_id = ? AND validation_status = 'needs_review' ORDER BY created_at DESC LIMIT 1"
  ).get(sessionId);
  const quote = db.prepare('SELECT * FROM quote_audit WHERE session_id = ?').get(sessionId);
  const pending = codingReview.listPending().filter((r) => r.call_id === sessionId);
  return {
    name: 'low_confidence',
    ok: result.error_code === 'CODING_REVIEW_REQUIRED'
      && !!review
      && !quote
      && pending.length >= 1,
    result_error: result.error_code,
    review_id: review?.id
  };
}

async function scenarioHighConfidence() {
  const sessionId = `hitl_high_${Date.now()}`;
  seedTriage(sessionId, { icd: 'K29.70', cpt: '99213', confidence: 0.85 });
  KellyToolExecutor._post = async () => ({ success: true });
  const result = await KellyToolExecutor._collectInsurance(
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', date_of_birth: '1990-01-15' },
    { sessionId, patientId: 'p_hitl2', callerPhone: '+15555550198' }
  );
  const review = db.prepare(
    "SELECT COUNT(*) AS c FROM coding_decisions WHERE call_id = ? AND validation_status = 'needs_review'"
  ).get(sessionId)?.c || 0;
  return {
    name: 'high_confidence_spine',
    ok: result.success === true && review === 0,
    result_success: result.success
  };
}

async function scenarioApproveResume() {
  const sessionId = `hitl_resume_${Date.now()}`;
  seedTriage(sessionId, { icd: 'K29.70', cpt: '99213', confidence: 0.50 });
  await KellyToolExecutor._collectInsurance(
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', date_of_birth: '1990-01-15' },
    { sessionId, patientId: 'p_hitl3', callerPhone: '+15555550197' }
  );
  const review = db.prepare(
    "SELECT * FROM coding_decisions WHERE call_id = ? AND validation_status = 'needs_review' ORDER BY created_at DESC LIMIT 1"
  ).get(sessionId);
  if (!review?.id) return { name: 'approve_resume', ok: false, reason: 'no review row' };
  codingReview.approveReview(review.id, { icd10: 'K29.70', cpt: '99213', resolved_by: 'test' });
  const resumed = db.prepare(
    "SELECT COUNT(*) AS c FROM kelly_call_events WHERE session_id = ? AND event_type = 'coding_hitl_resumed'"
  ).get(sessionId)?.c || 0;
  const ragConf = db.prepare(
    'SELECT rag_confidence FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId)?.rag_confidence;
  return {
    name: 'approve_resume',
    ok: resumed >= 1 && parseFloat(ragConf) >= 0.85,
    resumed,
    rag_confidence: ragConf
  };
}

async function main() {
  try {
    require('../migrations/084_coding_decisions_hitl').up(db);
  } catch (_) {}
  const results = [];
  results.push(await scenarioLowConfidence());
  results.push(await scenarioHighConfidence());
  results.push(await scenarioApproveResume());
  const success = results.every((r) => r.ok);
  console.log(JSON.stringify({ results, success }, null, 2));
  process.exit(success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
