#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';

const knowledgeService = require('../services/knowledge-service');
const TriageRAGService = require('../services/triage-rag-service');
const TriageRAGServiceV2 = require('../services/triage-rag-service-v2');
const db = require('../database').db;

async function main() {
  const checks = [];
  const assert = (name, ok, actual, expected) => checks.push({ name, pass: !!ok, actual, expected });

  const invalidPair = knowledgeService.validateCodePair('K29.70', '99285');
  assert('blocks_er_pair', invalidPair.valid === false, invalidPair.valid, false);

  const validPair = knowledgeService.validateCodePair('K29.70', '99213');
  assert('allows_outpatient_pair', validPair.valid === true, validPair.valid, true);

  const sessionId = `pair_val_${Date.now()}`;
  const Rag = process.env.USE_TRIAGE_RAG_V2 === '1' ? TriageRAGServiceV2 : TriageRAGService;
  await Rag.enrichFromSymptoms({
    sessionId,
    symptomText: 'stomach pain',
    opqrst: { quality: 'aching', onset: 'today' },
    richIntake: {},
    patientId: 'p_pair',
    clinicId: 'clinic-default',
    _ragResultOverride: {
      icdCodes: [{ code: 'K29.70', description: 'Gastritis', confidence: 0.9 }],
      cptCodes: [{ code: '99213', description: 'Office visit', confidence: 0.9 }]
    },
    _codingProvenance: { remote_source: 'test' }
  });

  const row = db.prepare(
    'SELECT primary_icd10, primary_cpt, coding_provenance_json FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);
  const prov = (() => { try { return JSON.parse(row?.coding_provenance_json || '{}'); } catch (_) { return {}; } })();
  assert('row_written', !!row?.primary_icd10 && !!row?.primary_cpt, row, 'codes set');
  assert('code_pair_valid_true', prov.code_pair_valid === true, prov.code_pair_valid, true);

  const { resolveInsuranceCodes } = require('../services/resolve-insurance-codes');
  const badSession = `pair_resolver_${Date.now()}`;
  db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, symptom_text, target_specialty, urgency, rag_confidence,
      primary_icd10, primary_cpt, seeded_for_harness, icd_codes, cpt_codes, created_at
    ) VALUES (?, ?, 'test', 'Gastroenterology', 'routine', 0.9, 'K29.70', '99285', 0, '[]', '[]', datetime('now'))
  `).run(`rag_${badSession}`, badSession);
  const blocked = resolveInsuranceCodes(badSession, { clinicId: 'clinic-default', patientId: 'p_pair' });
  assert('resolver_blocks_invalid_pair', blocked.ok === false && blocked.error_code === 'CODING_REVIEW_REQUIRED', blocked.error_code, 'CODING_REVIEW_REQUIRED');

  const failed = checks.filter((c) => !c.pass);
  console.log(JSON.stringify({ checks, success: failed.length === 0 }, null, 2));
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
