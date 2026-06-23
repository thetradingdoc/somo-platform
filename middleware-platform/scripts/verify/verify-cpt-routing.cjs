#!/usr/bin/env node
'use strict';

/**
 * Phase 1 B2 — CPT spine-first vs fallback routing via collect_insurance.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');
const KellyToolExecutor = require('../../services/kelly/kelly-tool-executor');

function seedTriage(sessionId, { primaryIcd10, primaryCpt, confidence }) {
  const ragId = uuidv4();
  db.db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, patient_id, symptom_text, opqrst_json,
      icd_codes, cpt_codes, target_specialty, urgency, safety_level,
      rag_confidence, primary_icd10, primary_cpt, seeded_for_harness, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `).run(
    ragId,
    sessionId,
    'patient_cpt_route',
    'stomach pain',
    JSON.stringify({ onset: 'today' }),
    JSON.stringify([{ code: primaryIcd10 }]),
    JSON.stringify([{ code: primaryCpt }]),
    'Gastroenterology',
    'routine',
    'green',
    confidence,
    primaryIcd10,
    primaryCpt
  );
  db.upsertTriageSession({
    session_id: sessionId,
    clinic_id: 'clinic-default',
    triage_complete: 1,
    opqrst_complete: 1,
    intake_complete_at: new Date().toISOString(),
    target_specialty: 'Gastroenterology',
    rag_result_id: ragId
  });
  return ragId;
}

async function runCase(name, confidence, expectSource, expectReason, testInsurance = true) {
  const sessionId = `cpt_route_${name}_${Date.now()}`;
  seedTriage(sessionId, { primaryIcd10: 'K29.70', primaryCpt: '99213', confidence });

  if (!testInsurance) {
    const { resolveCptForVisit } = require('../../utils/cpt-helper');
    const resolution = resolveCptForVisit({
      spineCpt: '99213',
      confidence,
      specialty: 'Gastroenterology',
      isNewPatient: true,
      urgency: 'routine'
    });
    const ok =
      resolution.code_source === expectSource &&
      (expectReason == null ? !resolution.fallback_reason : resolution.fallback_reason === expectReason);
    return { name, ok, resolution, result_success: ok };
  }

  let captured = null;
  const origPost = KellyToolExecutor._post.bind(KellyToolExecutor);
  KellyToolExecutor._post = async (url, body) => {
    if (String(url).includes('/voice/insurance/collect')) captured = body;
    return { success: true, data: body };
  };
  const result = await KellyToolExecutor._collectInsurance(
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x' },
    { sessionId, patientId: 'patient_cpt_route', callerPhone: '+15555550100' }
  );
  KellyToolExecutor._post = origPost;
  const ok =
    result?.success === true &&
    captured?.code_source === expectSource &&
    (expectReason == null ? !captured?.fallback_reason : captured?.fallback_reason === expectReason) &&
    captured?.primary_cpt === '99213';
  return { name, ok, captured, result_success: result?.success };
}

async function main() {
  try {
    require('../../database/migrations/081_seeded_for_harness').up(db.db);
  } catch (_) {}
  const spine = await runCase('spine', 0.75, 'spine', null, true);
  const fallback = await runCase('fallback', 0.50, 'fallback', 'low_confidence', false);
  const results = [spine, fallback];
  const success = results.every((r) => r.ok);
  console.log(JSON.stringify({ results, success }, null, 2));
  process.exit(success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
