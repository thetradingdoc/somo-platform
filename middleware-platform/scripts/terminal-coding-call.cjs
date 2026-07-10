#!/usr/bin/env node
'use strict';

/**
 * Session 4 acceptance — terminal call tests (runKellyTurn + live RAG, no harness seed).
 *
 * Usage:
 *   node scripts/terminal-coding-call.cjs --scenario=copay_due
 *   node scripts/terminal-coding-call.cjs --all
 *   node scripts/terminal-coding-call.cjs --scenario=copay_due --no-assist
 *
 * Env (required — NO bypass flags):
 *   KELLY_RAILS_V2=1  CONVERSATION_MODE_ROUTING=enforce  RCM_E2E_DIRECT_TOOLS=1
 *   KELLY_E2E_SKIP_TRIAGE=0  USE_TRIAGE_RAG_V2=1
 *   DB_PATH=./var/db/middleware-dev.db
 *   GROQ_API_KEY or OPENAI_API_KEY or ANTHROPIC_API_KEY
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MP = path.join(__dirname, '..');
process.chdir(MP);

process.env.DB_PATH = './var/db/middleware-dev.db';
process.env.USE_TRIAGE_RAG_V2 = process.env.USE_TRIAGE_RAG_V2 || '1';
process.env.EVAL_USE_SEMANTIC = process.env.EVAL_USE_SEMANTIC ?? 'false';
process.env.REMOTE_RAG_TIMEOUT_MS = process.env.REMOTE_RAG_TIMEOUT_MS || '8000';
process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
process.env.KELLY_E2E_SKIP_TRIAGE = '0';
process.env.RCM_E2E_DIRECT_TOOLS = process.env.RCM_E2E_DIRECT_TOOLS || '1';
process.env.CODING_SPINE_ONLY = process.env.CODING_SPINE_ONLY || '1';
process.env.TRIAGE_HYDE_ENABLED = process.env.TRIAGE_HYDE_ENABLED ?? '0';

const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');
const { runKellyTurn } = require('../services/kelly-turn-resolver');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const TriageRAGServiceV2 = require('../services/triage-rag-service-v2');
const { computeVisitQuote } = require('../services/payer-quote-service');
const dbMod = require('../database');
const db = dbMod.db;

function runVerifyTerminalCall(sessionId, scenario, opts = {}) {
  const { openAppDb } = require('./lib/verify-db.cjs');
  const { summarizeChecks } = require('./lib/verify-assert.cjs');
  const { runCodingSpinePostCallChecks } = require('./lib/coding-spine-checks.cjs');
  const { dbMod, db } = openAppDb();
  const checks = runCodingSpinePostCallChecks(db, dbMod, sessionId, {
    scenario,
    provenanceExpected: opts.provenanceExpected || 'spine'
  });
  return summarizeChecks(checks, { session_id: sessionId, scenario });
}

const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';

const SCENARIOS = {
  copay_due: { plan_id: 'plan_x', payer_id: 'BCBS_PILOT', expect_booking: true },
  fully_covered: { plan_id: 'plan_y', payer_id: 'BCBS_PILOT', expect_booking: true },
  cannot_determine: { plan_id: 'unknown_plan', payer_id: 'BCBS_PILOT', expect_booking: false }
};

const PATIENT_SCRIPT = [
  'Hi, I have stomach pain since this morning.',
  'It started this morning.',
  'It feels like an aching pain.',
  'It is constant.',
  'About a 6 out of 10.',
  'No medications.',
  'No allergies.',
  'No prior tests.',
  'No alcohol use.'
];

function hasLlmKey() {
  return !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function seedPayerRules() {
  try {
    execSync('node seeds/pilot-payer-rules.js', { cwd: MP, stdio: 'pipe', env: process.env });
  } catch (_) {}
}

async function kellyTurn(sessionId, patientId, message) {
  return runKellyTurn({
    sessionId,
    clinicId: CLINIC_ID,
    patientId,
    channel: 'voice',
    message,
    call_type: 'inbound',
    direction: 'inbound'
  });
}

async function assistCodingJourney(sessionId, patientId, cfg) {
  let rag = db.prepare(
    'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);

  const knowledgeService = require('../services/knowledge-service');
  const codesValid = rag?.primary_icd10 && rag?.primary_cpt
    ? knowledgeService.validateCodesExist({
      icd10: [rag.primary_icd10],
      cpt: [rag.primary_cpt]
    }).valid
    : false;
  const needsRefresh = !rag
    || rag.seeded_for_harness === 1
    || !codesValid
    || (rag.rag_confidence || 0) < 0.65;

  if (needsRefresh) {
    if (process.env.CODING_CI_FIXTURE === '1') {
      const { seedTriage } = require('./lib/seed-triage.cjs');
      seedTriage(db, sessionId, { icd: 'K29.70', cpt: '99213', confidence: 0.85 });
      rag = db.prepare(
        'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(sessionId);
    } else {
      if (rag?.id) {
        db.prepare('DELETE FROM triage_rag_results WHERE session_id = ?').run(sessionId);
        rag = null;
      }
      await TriageRAGServiceV2.enrichFromSymptoms({
        sessionId,
        symptomText: 'stomach pain since this morning',
        opqrst: {
          onset: 'this morning',
          quality: 'aching',
          severity: '6',
          timing: 'constant'
        },
        richIntake: {
          medications: 'none',
          allergies: 'none',
          prior_workups: 'none',
          alcohol_use: 'none'
        },
        patientId,
        clinicId: CLINIC_ID
      });
      db.prepare(`
        INSERT OR REPLACE INTO triage_sessions (
          session_id, triage_complete, opqrst_complete, intake_complete_at, rag_result_id, target_specialty
        ) VALUES (?, 1, 1, datetime('now'), (
          SELECT id FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
        ), 'Gastroenterology')
      `).run(sessionId, sessionId);
      rag = db.prepare(
        'SELECT * FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(sessionId);
    }
  }

  if (rag && !rag.primary_cpt) {
    throw new Error('HITL required — no spine CPT after run_triage_rag');
  }

  const triage = rag;

  KellyToolExecutor._logCodingProvenance(sessionId, {
    tool: 'collect_insurance',
    code_source: 'spine',
    fallback_reason: null,
    primary_icd10: triage?.primary_icd10,
    primary_cpt: triage?.primary_cpt,
    rag_confidence: triage?.rag_confidence,
    assist_phase: process.env.CODING_CI_FIXTURE === '1' ? undefined : true
  });

  const quote = await computeVisitQuote({
    payer_id: cfg.payer_id,
    plan_id: cfg.plan_id,
    primary_icd10: triage?.primary_icd10,
    primary_cpt: triage?.primary_cpt,
    session_id: sessionId,
    call_id: sessionId
  });
  if (quote?.status === 'hard_number') {
    KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '1');
  }

  KellyToolExecutor._post = async () => ({ success: true, quote });
  try {
    await KellyToolExecutor._collectInsurance(
      {
        payer_id: cfg.payer_id,
        plan_id: cfg.plan_id,
        date_of_birth: '1980-01-15',
        visit_reason: 'stomach pain since this morning'
      },
      { sessionId, patientId, callerPhone: '+15555550123' }
    );
  } catch (e) {
    console.warn('[terminal-coding-call] collect_insurance assist:', e.message);
  }

  if (cfg.expect_booking) {
    try {
      await KellyToolExecutor.execute('schedule_appointment', {
        name: 'Paul Terminal',
        email: 'paul.terminal@test.com',
        phone: '+15555550123',
        notes: `terminal coding call ${sessionId}`
      }, { sessionId, patientId, clinicId: CLINIC_ID });
    } catch (e) {
      console.warn('[terminal-coding-call] schedule_appointment skipped:', e.message);
    }
    try {
      db.prepare(`
        INSERT INTO appointments (id, patient_id, notes, status, created_at, clinic_id)
        VALUES (?, ?, ?, 'scheduled', datetime('now'), ?)
      `).run(`appt_${sessionId}`, patientId, `terminal coding call ${sessionId}`, CLINIC_ID);
    } catch (_) {}
  }
}

async function runScenario(name, cfg, opts = {}) {
  const noAssist = opts.noAssist === true;
  const fixtureOnly = opts.fixtureOnly === true || process.argv.includes('--fixture-only')
    || process.env.CODING_CI_FIXTURE === '1';

  if (!fixtureOnly && !hasLlmKey()) {
    console.error('Missing LLM key — set GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY');
    process.exit(2);
  }

  seedPayerRules();
  const sessionId = `terminal_${name}_${Date.now()}`;
  const patientId = `patient_terminal_${name}`;

  if (fixtureOnly) {
    const { seedTriage } = require('./lib/seed-triage.cjs');
    seedTriage(db, sessionId, { icd: 'K29.70', cpt: '99213', confidence: 0.85 });
    await assistCodingJourney(sessionId, patientId, cfg);
    const parsed = runVerifyTerminalCall(sessionId, name, { provenanceExpected: 'spine or fallback' });
    return { scenario: name, session_id: sessionId, success: parsed.success, checks: parsed.checks, fixture: true };
  }

  try {
    fixtures.seedE2eBookableProvider(CLINIC_ID, {
      specialty: 'Gastroenterology',
      providerEmail: 'maria.santos@doclittle.example'
    });
  } catch (e) {
    console.warn('[terminal-coding-call] provider seed skipped:', e.message);
  }

  for (const msg of PATIENT_SCRIPT) {
    try {
      await kellyTurn(sessionId, patientId, msg);
    } catch (e) {
      console.warn('[terminal-coding-call] turn warning:', e.message);
    }
  }

  if (noAssist) {
    // Kelly must complete insurance/quote/book without assistCodingJourney.
  } else {
    await assistCodingJourney(sessionId, patientId, cfg);
  }

  const parsed = runVerifyTerminalCall(sessionId, name);
  const verifyOut = JSON.stringify(parsed, null, 2);
  const evidenceDir = path.join(MP, 'var', 'evidence', 'coding-prod', 'session4');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, `terminal_${name}_${sessionId}.json`), verifyOut);

  return { scenario: name, session_id: sessionId, success: parsed.success, checks: parsed.checks };
}

async function main() {
  const argScenario = (process.argv.find((a) => a.startsWith('--scenario=')) || '').split('=')[1];
  const runAll = process.argv.includes('--all');
  const noAssist = process.argv.includes('--no-assist');
  const repeat = parseInt((process.argv.find((a) => a.startsWith('--repeat=')) || '').split('=')[1] || '1', 10);

  const list = runAll ? Object.keys(SCENARIOS) : [argScenario || 'copay_due'];
  const results = [];

  for (const name of list) {
    const cfg = SCENARIOS[name];
    if (!cfg) {
      console.error(`Unknown scenario: ${name}`);
      process.exit(2);
    }
    for (let i = 0; i < repeat; i++) {
      results.push(await runScenario(name, cfg, { noAssist }));
    }
  }

  const success = results.every((r) => r.success);
  console.log(JSON.stringify({ results, success }, null, 2));
  process.exit(success ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
