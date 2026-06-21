#!/usr/bin/env node
'use strict';

const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.CODING_SPINE_ONLY = '1';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const db = require('../database').db;

function seedTriage(sessionId) {
  const id = `quote_chain_${sessionId}`;
  db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, symptom_text, target_specialty, urgency, rag_confidence,
      primary_icd10, primary_cpt, icd_codes, cpt_codes, created_at
    ) VALUES (?, ?, 'test', 'Gastroenterology', 'routine', 0.85, 'K29.70', '99213', '[]', '[]', datetime('now'))
  `).run(id, sessionId);
  db.prepare(`
    INSERT OR REPLACE INTO triage_sessions (
      session_id, triage_complete, opqrst_complete, intake_complete_at, rag_result_id
    ) VALUES (?, 1, 1, datetime('now'), ?)
  `).run(sessionId, id);
}

async function main() {
  try {
    require('child_process').execSync('node seeds/pilot-payer-rules.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  } catch (_) {}

  const sessionId = `quote_chain_${Date.now()}`;
  seedTriage(sessionId);

  const { computeVisitQuote } = require('../services/payer-quote-service');
  KellyToolExecutor._post = async (_url, body) => {
    const quote = await computeVisitQuote({
      payer_id: body.payer_id,
      plan_id: body.plan_id,
      primary_icd10: body.primary_icd10,
      primary_cpt: body.primary_cpt,
      session_id: sessionId,
      call_id: sessionId
    });
    return { success: true, quote };
  };
  const result = await KellyToolExecutor._collectInsurance(
    { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', member_id: 'MBR123' },
    { sessionId, patientId: 'p_qc', callerPhone: '+15555550111' }
  );

  const quote = result?.quote;
  const audit = db.prepare('SELECT * FROM quote_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(sessionId);
  const resultJson = (() => { try { return JSON.parse(audit?.result_json || '{}'); } catch (_) { return {}; } })();

  const checks = [
    { name: 'collect_success', pass: result?.success === true },
    { name: 'quote_in_response', pass: !!quote },
    { name: 'quote_hard_number', pass: quote?.status === 'hard_number' },
    { name: 'audit_row', pass: !!audit },
    { name: 'allowed_amount', pass: resultJson.allowed_amount != null || quote?.allowed_amount != null }
  ];
  const success = checks.every((c) => c.pass);
  console.log(JSON.stringify({ checks, success }, null, 2));
  process.exit(success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
