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

async function main() {
  const names = toolNames(KELLY_TOOLS);
  const required = ['collect_insurance', 'compute_visit_quote', 'run_triage_rag', 'schedule_appointment'];
  const checks = required.map((n) => ({ name: n, present: names.includes(n) }));
  const missing = checks.filter((c) => !c.present).map((c) => c.name);

  let callable = true;
  try {
    const quote = await KellyToolExecutor.execute('compute_visit_quote', {
      payer_id: 'BCBS_PILOT',
      plan_id: 'plan_x',
      primary_icd10: 'K29.70',
      primary_cpt: '99213'
    }, { sessionId: `tool_check_${Date.now()}`, clinicId: 'clinic-default' });
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
