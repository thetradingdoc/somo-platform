#!/usr/bin/env node
'use strict';

/**
 * Kelly LLM tool surface must expose insurance + quote tools.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { KELLY_TOOLS } = require('../services/kelly-agent-service');
const KellyToolExecutor = require('../services/kelly-tool-executor');

function toolNames(tools) {
  return (tools || []).map((t) => t.function?.name || t.name).filter(Boolean);
}

function seedTriage(db, sessionId) {
  const id = `tool_check_rag_${sessionId}`;
  db.prepare(`
    INSERT INTO triage_rag_results (
      id, session_id, symptom_text, target_specialty, urgency, rag_confidence,
      primary_icd10, primary_cpt, seeded_for_harness, icd_codes, cpt_codes, created_at
    ) VALUES (?, ?, 'test', 'Gastroenterology', 'routine', 0.85, 'K29.70', '99213', 0, '[]', '[]', datetime('now'))
  `).run(id, sessionId);
  db.prepare(`
    INSERT OR REPLACE INTO triage_sessions (
      session_id, triage_complete, opqrst_complete, intake_complete_at, rag_result_id
    ) VALUES (?, 1, 1, datetime('now'), ?)
  `).run(sessionId, id);
}

async function main() {
  const names = toolNames(KELLY_TOOLS);
  const required = ['collect_insurance', 'compute_visit_quote', 'run_triage_rag', 'schedule_appointment'];
  const checks = required.map((n) => ({ name: n, present: names.includes(n) }));
  const missing = checks.filter((c) => !c.present).map((c) => c.name);

  let callable = true;
  const sessionId = `tool_check_${Date.now()}`;
  try {
    try {
      require('../migrations/081_seeded_for_harness').up(require('../database').db);
    } catch (_) {}
    try {
      require('child_process').execSync('node seeds/pilot-payer-rules.js', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
    } catch (_) {}
    seedTriage(require('../database').db, sessionId);
    const quote = await KellyToolExecutor.execute('compute_visit_quote', {
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x'
    }, { sessionId, clinicId: 'clinic-default' });
    callable = quote?.success === true || !!quote?.quote;
  } catch (e) {
    callable = false;
  }

  const summary = {
    tool_names: names,
    required,
    missing,
    compute_visit_quote_callable: callable,
    success: missing.length === 0 && callable
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
