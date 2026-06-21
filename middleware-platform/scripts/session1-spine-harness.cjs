#!/usr/bin/env node
'use strict';

/**
 * Session 1 terminal harness — Pinecone readiness + triage/suggest parity.
 * Session 1 scope: dual-source spine only (SQLite codebook validation is Session 2).
 */

const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';
process.env.USE_TRIAGE_RAG_V2 = process.env.USE_TRIAGE_RAG_V2 || '1';

const FIXTURE =
  process.env.SESSION1_SYMPTOM ||
  'persistent headache with light sensitivity since this morning';

async function main() {
  const mp = path.join(__dirname, '..');
  console.log('==> Pinecone readiness');
  const readinessRaw = execSync(
    `node -r dotenv/config scripts/verify-reasoning-pinecone-readiness.cjs dotenv_config_path=.env`,
    { cwd: mp, encoding: 'utf8' }
  );
  console.log(readinessRaw);
  const readinessJson = JSON.parse(readinessRaw.match(/\{[\s\S]*\}/)[0]);
  if (!readinessJson.configured || !readinessJson.populated) {
    console.error('FAIL: pinecone not ready');
    process.exit(2);
  }

  process.chdir(mp);
  const TriageRAGService = require('../services/triage-rag-service');
  const TriageRAGServiceV2 = require('../services/triage-rag-service-v2');
  const knowledgeService = require('../services/knowledge-service');
  const KellyToolExecutor = require('../services/kelly-tool-executor');

  const opqrst = { onset: 'this morning', quality: 'throbbing', severity: 7, timing: 'constant' };
  const richIntake = { medications: 'none', allergies: 'none' };
  const combinedText = TriageRAGService._buildCombinedText(FIXTURE, opqrst, richIntake);
  const sessionId = `sess_harness_${Date.now()}`;

  const triage = await TriageRAGServiceV2.enrichFromSymptoms({
    sessionId,
    symptomText: FIXTURE,
    opqrst,
    richIntake,
    clinicId: 'clinic-default'
  });

  const dual = await knowledgeService.getCodeCandidatesDualSource(combinedText, {
    clinicId: 'clinic-default',
    callId: sessionId,
    maxIcd10: 5
  });

  const kellySuggest = await KellyToolExecutor.execute(
    'suggest_codes_from_symptoms',
    { symptom_text: FIXTURE, clinical_text: combinedText },
    { sessionId: `${sessionId}_suggest`, clinicId: 'clinic-default' }
  );

  const norm = (c) => (c ? String(c).replace(/\./g, '').toUpperCase() : null);
  const triageTop = triage?.icd_codes?.[0]?.code || triage?.primary_icd10 || null;
  const dualTop =
    dual?.remote_knowledge?.icd10?.[0]?.code ||
    dual?.icd10?.[0]?.code ||
    null;
  const kellyTop =
    kellySuggest?.primary_icd10 ||
    kellySuggest?.data?.primary_icd10 ||
    kellySuggest?.icd10?.[0]?.code ||
    null;
  const triageSet = new Set(
    [triageTop, triage?.primary_icd10, ...(triage?.icd_codes || []).map((c) => c.code)]
      .filter(Boolean)
      .map(norm)
  );
  const suggestSet = new Set(
    [
      dualTop,
      kellyTop,
      ...(dual?.remote_knowledge?.icd10 || []).map((c) => c.code),
      ...(dual?.icd10 || []).map((c) => c.code)
    ]
      .filter(Boolean)
      .map(norm)
  );
  const overlap = [...triageSet].some((c) => suggestSet.has(c));
  const remote =
    dual?.remote_knowledge?.metadata?.source ||
    kellySuggest?.source_breakdown?.remote ||
    'none';

  const remoteHasCodes = (dual?.remote_knowledge?.icd10 || []).length > 0;
  const result = {
    fixture: FIXTURE,
    primary_icd10: triage?.primary_icd10 || null,
    triage_top_icd10: triageTop,
    dual_source_top_icd10: dualTop,
    kelly_suggest_top_icd10: kellyTop,
    remote_source: remote,
    remote_icd_count: (dual?.remote_knowledge?.icd10 || []).length,
    parity: norm(triageTop) === norm(dualTop) || overlap,
    note: 'Triage v2 may rerank/HyDE; Session 1 requires pinecone spine + non-empty triage ICD',
    assertion_passed:
      Boolean(triage?.primary_icd10) &&
      String(remote).includes('pinecone') &&
      remoteHasCodes
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.assertion_passed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
