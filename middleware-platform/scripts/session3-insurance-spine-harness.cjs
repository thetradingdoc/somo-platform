#!/usr/bin/env node
'use strict';

/**
 * Session 3 terminal harness — insurance bound to coding spine.
 * Seeds validated triage rag row + runs collect_insurance (fast, no live Pinecone).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const { v4: uuidv4 } = require('uuid');

async function seedTriageRow(db, sessionId, patientId) {
  const primaryIcd10 = 'K29.70';
  const primaryCpt = '99213';
  const ragId = uuidv4();
  const intakeAt = new Date().toISOString();
  const icdJson = JSON.stringify([{ code: primaryIcd10, description: 'Gastritis' }]);
  const cptJson = JSON.stringify([{ code: primaryCpt, description: 'Office visit' }]);

  db.db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, patient_id, symptom_text, opqrst_json,
      icd_codes, cpt_codes, target_specialty, urgency, safety_level,
      rag_confidence, primary_icd10, primary_cpt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    ragId,
    sessionId,
    patientId,
    'stomach pain since yesterday with nausea after meals',
    JSON.stringify({ onset: 'yesterday', quality: 'cramping', severity: 6 }),
    icdJson,
    cptJson,
    'Gastroenterology',
    'routine',
    'green',
    0.85,
    primaryIcd10,
    primaryCpt
  );

  db.upsertTriageSession({
    session_id: sessionId,
    clinic_id: 'clinic-default',
    triage_complete: 1,
    opqrst_complete: 1,
    intake_complete_at: intakeAt,
    target_specialty: 'Gastroenterology',
    rag_result_id: ragId
  });

  return { ragId, primaryIcd10, primaryCpt, intakeAt };
}

async function main() {
  const db = require('../database');
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  const { computeVisitQuote } = require('../services/payer-quote-service');

  const sessionId = `sess_s3_${Date.now()}`;
  const patientId = 'patient_s3_harness';
  const seeded = await seedTriageRow(db, sessionId, patientId);

  let captured = null;
  const origPost = KellyToolExecutor._post.bind(KellyToolExecutor);
  KellyToolExecutor._post = async (url, body) => {
    if (String(url).includes('/voice/insurance/collect')) captured = body;
    return { success: true, data: body };
  };

  const insResult = await KellyToolExecutor._collectInsurance(
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x' },
    { sessionId, patientId, callerPhone: '+15555550100' }
  );

  KellyToolExecutor._post = origPost;

  const quoteMissing = await computeVisitQuote({
    payer_id: 'bluecross',
    plan_id: 'plan_x',
    session_id: sessionId
  });

  const quoteWithCodes = captured
    ? await computeVisitQuote({
      payer_id: 'bluecross',
      plan_id: 'plan_x',
      primary_icd10: captured.primary_icd10,
      primary_cpt: captured.primary_cpt,
      session_id: sessionId
    })
    : null;

  const ragRow = db.db.prepare(
    'SELECT primary_icd10, primary_cpt FROM triage_rag_results WHERE id = ?'
  ).get(seeded.ragId);

  const result = {
    session_id: sessionId,
    triage_primary_icd10: seeded.primaryIcd10,
    triage_primary_cpt: seeded.primaryCpt,
    rag_row_primary_cpt: ragRow?.primary_cpt || null,
    collect_insurance_success: insResult?.success === true,
    collect_payload: captured
      ? {
        primary_icd10: captured.primary_icd10,
        primary_cpt: captured.primary_cpt,
        code_source: captured.code_source,
        service_code: captured.service_code
      }
      : null,
    code_source_spine: captured?.code_source === 'spine',
    primary_cpt_matches_triage:
      captured?.primary_cpt === seeded.primaryCpt,
    missing_codes_blocks_quote: quoteMissing.status === 'cannot_determine',
    quote_with_codes_status: quoteWithCodes?.status || null,
    assertion_passed:
      insResult?.success === true &&
      captured?.code_source === 'spine' &&
      captured?.primary_icd10 === seeded.primaryIcd10 &&
      captured?.primary_cpt === seeded.primaryCpt &&
      ragRow?.primary_cpt === seeded.primaryCpt &&
      quoteMissing.status === 'cannot_determine' &&
      quoteWithCodes?.status === 'hard_number'
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.assertion_passed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
