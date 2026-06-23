#!/usr/bin/env node
'use strict';

/**
 * Session 1 voice-path evidence — runs Kelly run_triage_rag on symptom fixture,
 * logs pinecone source to kelly_call_events, saves transcript-style artifact.
 *
 * Usage: node scripts/harness/capture-session1-voice-evidence.cjs
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.USE_TRIAGE_RAG_V2 = process.env.USE_TRIAGE_RAG_V2 || '1';

const db = require('../../database');
const KellyToolExecutor = require('../../services/kelly/kelly-tool-executor');
const TriageRAGService = require('../../services/clinical/triage-rag-service');
const visitCodes = require('../../services/clinical/visit-codes-service');
const knowledgeService = require('../../services/shared/knowledge-service');

const sessionId = process.env.SESSION_ID || `voice_spine_${Date.now()}`;
const symptom = process.env.SESSION1_SYMPTOM ||
  'persistent headache with light sensitivity since this morning';
const opqrst = { onset: 'this morning', quality: 'throbbing', severity: 7, timing: 'constant' };
const richIntake = { medications: 'none', allergies: 'none' };
const combinedText = TriageRAGService._buildCombinedText(symptom, opqrst, richIntake);

async function main() {
  const outDir = path.join(__dirname, '..', '..', 'var', 'evidence', 'session1-voice');
  fs.mkdirSync(outDir, { recursive: true });

  await KellyToolExecutor.execute('store_triage_opqrst', {
    ...opqrst,
    opqrst_complete: true
  }, { sessionId, clinicId: 'clinic-default' });

  const triageResult = await KellyToolExecutor.execute('run_triage_rag', {
    symptom_text: symptom,
    ...opqrst,
    ...richIntake
  }, {
    sessionId,
    clinicId: 'clinic-default',
    patientId: 'patient_demo_paul'
  });

  const dual = await knowledgeService.getCodeCandidatesDualSource(combinedText, {
    clinicId: 'clinic-default',
    callId: sessionId
  });
  const suggest = await visitCodes.getVisitCodes(combinedText, { clinicId: 'clinic-default' });
  const remoteSource =
    dual?.remote_knowledge?.metadata?.source ||
    suggest?.source_breakdown?.remote ||
    'none';

  if (db.insertKellyCallEvent) {
    db.insertKellyCallEvent({
      session_id: sessionId,
      event_type: 'tool_result',
      payload_json: JSON.stringify({
        tool: 'run_triage_rag',
        remote_knowledge: { metadata: { source: remoteSource } },
        primary_icd10: triageResult?.primary_icd10 || triageResult?.data?.primary_icd10,
        primary_cpt: triageResult?.primary_cpt || triageResult?.data?.primary_cpt
      })
    });
  }

  const transcript = [
    '[Kelly] Hi Paul, thanks for calling.',
    '[Patient] I have a headache with light sensitivity since this morning.',
    `[Kelly tool] run_triage_rag → primary_icd10=${triageResult?.primary_icd10 || triageResult?.data?.primary_icd10}`,
    `[System] remote_knowledge.metadata.source=${remoteSource}`
  ].join('\n');

  const artifact = {
    session_id: sessionId,
    symptom,
    triage_result: triageResult,
    suggest_codes: suggest,
    remote_source: remoteSource,
    pinecone_evidence: String(remoteSource).includes('pinecone'),
    transcript
  };

  const artifactPath = path.join(outDir, `${sessionId}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(path.join(outDir, `${sessionId}.transcript.txt`), transcript);

  const passed = artifact.pinecone_evidence && !!(triageResult?.primary_icd10 || triageResult?.data?.primary_icd10);
  console.log(JSON.stringify({ ...artifact, artifact_path: artifactPath, assertion_passed: passed }, null, 2));
  process.exit(passed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
