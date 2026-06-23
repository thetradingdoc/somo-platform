#!/usr/bin/env node
/**
 * Production-path E2E: KellyAgentService.processTurn (same code as POST /api/patient/triage/message).
 *
 * Prerequisites:
 *   - Keys: GROQ_API_KEY and/or ANTHROPIC_API_KEY / OPENAI_API_KEY (Kelly primary provider)
 *   - DEFAULT_CLINIC_ID or PRIMARY_CLINIC_ID in .env (or pass CLINIC_ID=...)
 *   - DERM_EDUCATION_PIPELINE_ENABLED=true for run_derm_patient_qa to appear in tool list
 *
 * Logging:
 *   - DERM_QA_E2E_LOG=1 — logs [DERM_QA_E2E] JSON when the derm tool runs (see kelly-tool-executor)
 *   - KELLY_DEBUG_TURN=1 — extra Kelly debug lines (if supported)
 *
 * Fast mode (no LLM inside derm pipeline; Kelly still uses LLM for tool orchestration):
 *   DERM_QA_SKIP_LLM=true node scripts/e2e-kelly-derm-qa.cjs
 *
 * Usage:
 *   cd middleware-platform && DERM_EDUCATION_PIPELINE_ENABLED=true DERM_QA_E2E_LOG=1 node scripts/e2e-kelly-derm-qa.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  try {
    require('dotenv').config({ path: envPath });
  } catch (_) {
    /* dotenv optional */
  }
}

if (process.env.DERM_QA_E2E_FORCE !== '0') {
  process.env.DERM_EDUCATION_PIPELINE_ENABLED = 'true';
}
process.env.DERM_QA_E2E_LOG = process.env.DERM_QA_E2E_LOG || '1';

process.chdir(root);

const { v4: uuidv4 } = require('uuid');

const clinicId =
  process.env.CLINIC_ID ||
  process.env.DEFAULT_CLINIC_ID ||
  process.env.PRIMARY_CLINIC_ID ||
  'clinic-default';

const sessionId = `e2e_derm_${uuidv4()}`;

const TURNS = [
  {
    label: 'Turn 1 — scope (avoid triage booking rabbit hole)',
    message:
      'I am not trying to book an appointment. I only have a dermatology education question about topical retinoids.'
  },
  {
    label: 'Turn 2 — Reddit-style product question (should invoke run_derm_patient_qa when model cooperates)',
    message:
      'Is tretinoin purging still normal in month 3 on 0.05% cream? I am flaky and breaking out more than before.'
  }
];

function hasLlmEnv() {
  return !!(
    process.env.GROQ_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

async function main() {
  console.log('═'.repeat(76));
  console.log('E2E — Kelly + derm patient Q&A pipeline (processTurn = triage/chat path)');
  console.log('═'.repeat(76));
  console.log(`cwd: ${process.cwd()}`);
  console.log(`session_id: ${sessionId}`);
  console.log(`clinic_id: ${clinicId}`);
  console.log(`DERM_EDUCATION_PIPELINE_ENABLED: ${process.env.DERM_EDUCATION_PIPELINE_ENABLED}`);
  console.log(`DERM_QA_SKIP_LLM (pipeline): ${process.env.DERM_QA_SKIP_LLM || '(unset)'}`);
  console.log(`DERM_QA_E2E_LOG: ${process.env.DERM_QA_E2E_LOG}`);
  console.log(`LLM env present: ${hasLlmEnv() ? 'yes' : 'NO — Phase A skipped'}\n`);

  let sawDermTool = false;

  if (hasLlmEnv()) {
    const KellyAgentService = require('../services/kelly/kelly-agent-service');

    for (let i = 0; i < TURNS.length; i++) {
      const t = TURNS[i];
      console.log('-'.repeat(76));
      console.log(`${t.label}`);
      console.log(`User:\n${t.message}\n`);

      const started = Date.now();
      let result;
      try {
        result = await KellyAgentService.processTurn({
          message: t.message,
          sessionId,
          channel: 'chat',
          clinicId,
          patientId: null,
          patientEmail: null,
          portalSessionId: null
        });
      } catch (e) {
        console.error('processTurn threw:', e.message);
        process.exit(1);
      }
      const ms = Date.now() - started;

      const toolsUsed = Array.isArray(result.toolsUsed) ? result.toolsUsed : [];
      if (toolsUsed.includes('run_derm_patient_qa')) sawDermTool = true;

      console.log(`Latency: ${ms} ms`);
      console.log(
        JSON.stringify(
          {
            toolsUsed,
            language: result.language,
            endCall: !!result.endCall,
            reply_preview: (result.reply || '').slice(0, 900) + ((result.reply || '').length > 900 ? '…' : '')
          },
          null,
          2
        )
      );
      console.log('');
    }

    console.log('═'.repeat(76));
    console.log(`Phase A summary: run_derm_patient_qa invoked by LLM at least once: ${sawDermTool}`);
    if (!sawDermTool) {
      console.log(
        'Note: The model may choose other tools. If you saw "Connection error", fix network and API access, then re-run.'
      );
    }
    console.log('═'.repeat(76));
  } else {
    console.log('Skipping Phase A (no LLM API keys). Set GROQ_API_KEY or ANTHROPIC_API_KEY or OPENAI_API_KEY.\n');
  }

  await runDirectToolProbe(sessionId, clinicId);
}

/**
 * Always runs: proves kelly-tool-executor + derm pipeline + [DERM_QA_E2E] log without LLM tool selection.
 */
async function runDirectToolProbe(sessionId, clinicId) {
  console.log('\n' + '═'.repeat(76));
  console.log('Phase B — KellyToolExecutor.execute(run_derm_patient_qa) — production executor path');
  console.log('═'.repeat(76));

  const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
  const ctx = {
    sessionId: `${sessionId}_tool_probe`,
    clinicId,
    patientId: null,
    callerPhone: null,
    channel: 'chat'
  };
  const args = {
    message: 'Is tretinoin purging still normal in month 3 on 0.05% cream?'
  };

  const out = await KellyToolExecutor.execute('run_derm_patient_qa', args, ctx);
  console.log(
    JSON.stringify(
      {
        success: out.success,
        error: out.error || null,
        compose_mode: out.compose && out.compose.mode,
        abstain_reason: out.compose && out.compose.abstain_reason,
        llm_used: out.llm_used,
        answer_excerpt: out.answer_text ? String(out.answer_text).slice(0, 320) : null
      },
      null,
      2
    )
  );
  console.log('(Above should include a line [DERM_QA_E2E] {...} when DERM_QA_E2E_LOG=1)\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
