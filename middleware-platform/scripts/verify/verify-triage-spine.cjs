#!/usr/bin/env node
'use strict';

/**
 * Session 2 acceptance — RAG-first triage spine (no seed).
 *
 * PASS when run_triage_rag for "stomach pain since this morning":
 *   - triage_rag_results.seeded_for_harness = 0
 *   - primary_icd10 prefix in K2|K5|R10
 *   - primary_cpt non-null, validates in codebook
 *   - rag_confidence >= 0.65
 *   - coding_decisions row NOT created (confident path)
 *
 * Run:
 *   USE_TRIAGE_RAG_V2=1 REMOTE_RAG_TIMEOUT_MS=8000 EVAL_USE_SEMANTIC=false \
 *     DB_PATH=./var/db/middleware-dev.db node scripts/verify/verify-triage-spine.cjs
 * exit 0
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.USE_TRIAGE_RAG_V2 = process.env.USE_TRIAGE_RAG_V2 || '1';
process.env.EVAL_USE_SEMANTIC = process.env.EVAL_USE_SEMANTIC ?? 'false';
process.env.REMOTE_RAG_TIMEOUT_MS = process.env.REMOTE_RAG_TIMEOUT_MS || '8000';

const dbMod = require('../../database');
const db = dbMod.db;
const TriageRAGServiceV2 = require('../../services/clinical/triage-rag-service-v2');
const knowledgeService = require('../../services/shared/knowledge-service');
const { CODING_CONFIDENCE_THRESHOLD } = require('../../config/coding-thresholds');

try {
  require('../../database/migrations/081_seeded_for_harness').up(db);
  require('../../database/migrations/082_coding_provenance_json').up(db);
} catch (_) {}

const PREFIXES = ['K2', 'K5', 'R10'];

function icdMatches(code) {
  const norm = String(code || '').replace(/\./g, '').toUpperCase();
  return PREFIXES.some((p) => norm.startsWith(p));
}

async function runSpine(sessionId) {
  db.prepare('DELETE FROM triage_rag_results WHERE session_id = ?').run(sessionId);
  return TriageRAGServiceV2.enrichFromSymptoms({
    sessionId,
    symptomText: 'stomach pain since this morning',
    opqrst: {
      onset: 'this morning',
      quality: 'aching',
      severity: '6',
      timing: 'constant'
    },
    richIntake: {
      medications: 'none',
      allergies: 'none',
      prior_workups: 'none',
      alcohol_use: 'none'
    },
    patientId: 'patient_verify_spine',
    clinicId: 'clinic-default'
  });
}

function pineconeProvenance(row) {
  try {
    const p = JSON.parse(row?.coding_provenance_json || '{}');
    return String(p.remote_source || '').includes('pinecone');
  } catch (_) {
    return false;
  }
}

async function main() {
  const sessionId = `verify_triage_spine_${Date.now()}`;
  let result = await runSpine(sessionId);
  let row = db.prepare(
    'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);

  if (!pineconeProvenance(row)) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await runSpine(sessionId);
    row = db.prepare(
      'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(sessionId);
  }

  const reviewCount = db.prepare(
    "SELECT COUNT(*) AS c FROM coding_decisions WHERE call_id = ? AND validation_status = 'needs_review'"
  ).get(sessionId)?.c || 0;

  const validation = row?.primary_icd10 && row?.primary_cpt
    ? knowledgeService.validateCodesExist({
      icd10: [row.primary_icd10],
      cpt: [row.primary_cpt]
    })
    : { valid: false };

  const checks = {
    triage_row: !!row,
    not_harness_seeded: !(row?.seeded_for_harness === 1),
    plausible_icd: icdMatches(row?.primary_icd10),
    primary_cpt: !!row?.primary_cpt,
    codes_validate: validation.valid === true,
    rag_confidence: (row?.rag_confidence || result?.rag_confidence || 0) >= CODING_CONFIDENCE_THRESHOLD,
    no_hitl_review: reviewCount === 0,
    remote_source_pinecone: pineconeProvenance(row)
  };

  const success = Object.values(checks).every(Boolean);
  const summary = {
    session_id: sessionId,
    primary_icd10: row?.primary_icd10,
    primary_cpt: row?.primary_cpt,
    rag_confidence: row?.rag_confidence,
    checks,
    success
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
