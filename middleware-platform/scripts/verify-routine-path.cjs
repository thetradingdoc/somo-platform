#!/usr/bin/env node
'use strict';

/**
 * Routine/no-symptoms path must use preventive spine ICD — never CPT_TABLE with null ICD.
 */

const { bootstrapVerifyEnv } = require('./lib/verify-env.cjs');
bootstrapVerifyEnv({ codingSpineOnly: true });

const { openAppDb } = require('./lib/verify-db.cjs');
const { summarizeChecks } = require('./lib/verify-assert.cjs');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { ensurePreventiveSpine, isPreventiveIcd } = require('../services/preventive-visit-spine');

const { db } = openAppDb();

async function main() {
  const sessionId = `routine_${Date.now()}`;
  KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');

  const preventive = await ensurePreventiveSpine({
    sessionId,
    patientId: 'p_routine_test',
    clinicId: 'clinic-default',
    isNewPatient: true
  });

  const checks = [];
  const assert = (name, ok, actual, expected) => checks.push({ name, pass: !!ok, actual, expected });

  assert('not_hitl', !preventive.hitl_required, preventive.hitl_required, false);
  assert('primary_icd10_set', !!preventive.primary_icd10, preventive.primary_icd10, 'Z00.xx');
  assert('preventive_icd', isPreventiveIcd(preventive.primary_icd10), preventive.primary_icd10, 'preventive');
  assert('primary_cpt_set', !!preventive.primary_cpt, preventive.primary_cpt, 'non-null');
  assert('code_source_spine', preventive.code_source === 'spine', preventive.code_source, 'spine');

  const rag = db.prepare(
    'SELECT primary_icd10, primary_cpt FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);
  assert('rag_row_icd', !!rag?.primary_icd10, rag?.primary_icd10, 'non-null');
  assert('rag_row_cpt', !!rag?.primary_cpt, rag?.primary_cpt, 'non-null');

  const failed = checks.filter((c) => !c.pass);
  const summary = summarizeChecks(checks);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
