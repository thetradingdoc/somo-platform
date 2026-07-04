#!/usr/bin/env node
'use strict';

/**
 * Kelly multilang conversation eval — production runKellyTurn path.
 *
 * Run:
 *   npm run test:eval:multilang:smoke
 *   npm run test:eval:multilang
 *   CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang
 *   MULTILANG_EVAL_RUNS=3 npm run test:eval:multilang   # majority for ticket triage
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MP = path.join(__dirname, '..');
process.chdir(MP);

const {
  MULTILANG_SCENARIOS,
  registryHash,
  listMultilangScenarios,
  getScenarioById
} = require('../e2e/scenario-registry/dental-front-desk.cjs');
const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');
const driver = require('../e2e/helpers/kelly-conversation-driver.cjs');
const { assertSessionCopayParity } = require('../e2e/helpers/copay-desk-parity.cjs');
const {
  runCrossCuttingAssertions,
  scenarioHasAutomatedChecks,
  isCopayPaymentScenario
} = require('../e2e/helpers/multilang-eval-assertions.cjs');

const OUT_DIR = path.join(MP, 'test-results', 'multilang-conversation-eval');
const DEFAULT_CLINIC_ID = process.env.TEST_CLINIC_ID || process.env.PHASE2_PILOT_CLINIC_ID || 'clinic-default';
const STRICT = process.env.CONVERSATION_EVAL_STRICT === '1';
const EVAL_RUNS = Math.max(1, parseInt(process.env.MULTILANG_EVAL_RUNS || '1', 10) || 1);
const MAJORITY_RUNS = Math.max(2, parseInt(process.env.MULTILANG_MAJORITY_RUNS || '3', 10) || 3);

function parseArgs() {
  const args = process.argv.slice(2);
  const lang = args.find((a) => a.startsWith('--lang='))?.split('=')[1];
  const intent = args.find((a) => a.startsWith('--intent='))?.split('=')[1];
  const scenario = args.find((a) => a.startsWith('--scenario='))?.split('=')[1];
  const tag = args.find((a) => a.startsWith('--tag='))?.split('=')[1];
  return { lang, intent, scenario, tag };
}

function checkAssertions(scenario, result, ctx) {
  const findings = [];
  const tools = result.toolsUsed || [];

  if (scenario.expectedTools) {
    for (const t of scenario.expectedTools) {
      findings.push({
        pass: tools.some((x) => x === t || String(x).includes(t)),
        check: `tool ${t} called`,
        got: tools
      });
    }
  }
  if (scenario.optionalTools) {
    for (const t of scenario.optionalTools) {
      const hit = tools.some((x) => x === t || String(x).includes(t));
      findings.push({
        pass: true,
        check: `optional tool ${t}`,
        optional: true,
        called: hit,
        got: tools
      });
    }
  }
  if (scenario.toolsMustNotInclude) {
    for (const t of scenario.toolsMustNotInclude) {
      findings.push({
        pass: !tools.some((x) => x === t || String(x).includes(t)),
        check: `tool ${t} not called`,
        got: tools
      });
    }
  }
  if (scenario.noFakeCopayIfThin && result.sessionMeta?.eligibility_quality === 'thin') {
    const spoke = /\$\d/.test(result.finalReply || '');
    findings.push({ pass: !spoke, check: 'no guessed copay on thin eligibility' });
  }
  if (scenario.noCardOnCall) {
    const asked = (result.transcript || []).some((t) =>
      /card number|card ending in|expiration date/i.test(t.text || '')
    );
    findings.push({ pass: !asked, check: 'no card collected on call' });
  }
  if (scenario.expectForceLanguageHandoff) {
    findings.push({
      pass: !!result.forceLanguageHandoff,
      check: 'forceLanguageHandoff set for unsupported language',
      got: result.forceLanguageHandoff
    });
  }

  const cross = runCrossCuttingAssertions(scenario, result, ctx);
  findings.push(...cross);

  const actionable = findings.filter((f) => !f.optional);
  const assertionVacuous = actionable.length === 0 && !scenarioHasAutomatedChecks(scenario);
  if (assertionVacuous) {
    findings.push({
      pass: false,
      check: 'scenario has actionable automated assertions',
      code: 'assertion_vacuous'
    });
  }

  return { findings, assertionVacuous, findingCount: actionable.length };
}

function resolveMultilangScenario(scenario) {
  const extendIds = scenario.extends
    ? Array.isArray(scenario.extends)
      ? scenario.extends
      : [scenario.extends]
    : [];
  let merged = { ...scenario };
  for (const id of extendIds) {
    const base = getScenarioById(id);
    if (!base) continue;
    merged = {
      ...base,
      ...merged,
      utterances: merged.utterances?.length ? merged.utterances : base.utterances,
      expectedTools: merged.expectedTools || base.expectedTools,
      optionalTools: merged.optionalTools || base.optionalTools,
      assertions: merged.assertions || base.assertions,
      copayScenario: merged.copayScenario ?? base.copayScenario,
      // Eligibility-tagged scenarios (evalTags includes 'copay_eligibility') must NOT inherit
      // copayPayment from DENTAL-003 — see H1 / money-movement-v2-backlog.
      copayPayment:
        merged.copayPayment ??
        ((merged.evalTags || []).includes('copay_eligibility') ? false : base.copayPayment),
      evalTags: merged.evalTags || base.evalTags,
      thinEligibility: merged.thinEligibility ?? base.thinEligibility,
      checkSessionDeskParity: merged.checkSessionDeskParity ?? base.checkSessionDeskParity
    };
  }
  return merged;
}

async function prepareScenario(scenario) {
  scenario = resolveMultilangScenario(scenario);
  const sessionId = fixtures.newE2eSessionId(`ml_${scenario.lang}`);
  const db = require('../database');
  const customerId = db.getCustomerIdForClinic?.(DEFAULT_CLINIC_ID) || null;
  fixtures.seedMultilangSession({
    clinicId: DEFAULT_CLINIC_ID,
    language_mode: scenario.language_mode || 'en_only',
    customerId
  });
  fixtures.seedDentalFrontDeskSession(sessionId, DEFAULT_CLINIC_ID, scenario);
  const patientEmail = `e2e-ml-${scenario.id}-${sessionId}@somo.test`;
  const seeded = fixtures.seedPatient({
    phone: require('../e2e/helpers/e2e-phone.cjs').e2eTestPhoneE164(),
    email: patientEmail,
    patientName: String(scenario.persona || 'E2E Multilang').split('—')[0].trim() || 'E2E Multilang'
  });
  const patientId = seeded.patientId;
  const KellyToolExecutor = require('../services/kelly-tool-executor');

  KellyToolExecutor._setSessionMeta(sessionId, 'resolved_patient_id', patientId);
  KellyToolExecutor._setSessionMeta(sessionId, 'customer_id', customerId || '');
  KellyToolExecutor._setSessionMeta(sessionId, 'preferred_language', scenario.lang || 'en');
  if (seeded.phone) {
    KellyToolExecutor._setSessionMeta(sessionId, 'fd_phone', seeded.phone);
    KellyToolExecutor._setSessionMeta(sessionId, 'caller_phone', seeded.phone);
  }

  try {
    const { storeFrontDeskFields } = require('../services/front-desk-intake');
    const visitReason = scenario.requiresExistingAppointment
      ? 'cancellation'
      : scenario.copayScenario
        ? 'cleaning'
        : scenario.intent === 'booking'
          ? scenario.lang === 'ru'
            ? 'exam'
            : 'cleaning'
          : null;
    const intakeFields = {
      full_name: seeded.patientName,
      phone: seeded.phone,
      date_of_birth: '1990-01-15',
      patient_status: scenario.requiresExistingAppointment ? 'returning' : 'new'
    };
    if (visitReason) intakeFields.reason_for_visit = visitReason;
    if (scenario.family_caller) intakeFields.family_caller = 'yes';
    storeFrontDeskFields(sessionId, intakeFields);
    if (visitReason) {
      KellyToolExecutor._setSessionMeta(sessionId, 'reason_for_visit', visitReason);
      KellyToolExecutor._setSessionMeta(sessionId, 'visit_reason', visitReason);
    }
  } catch (_) {}

  if (scenario.intent === 'booking' && scenario.expectedTools?.includes('schedule_appointment')) {
    try {
      const crypto = require('crypto');
      const ragId = `rag_ml_${crypto.randomBytes(6).toString('hex')}`;
      const nowIso = new Date().toISOString();
      if (db.db) {
        db.db
          .prepare(
            `INSERT OR REPLACE INTO triage_rag_results (
              id, session_id, patient_id, symptom_text, target_specialty, urgency, safety_level,
              rag_confidence, soap_note, created_at, cpt_codes, icd_codes
            ) VALUES (?, ?, ?, ?, 'Dental', 'routine', 'green', 0.95, 'routine dental cleaning', ?, ?, ?)`
          )
          .run(
            ragId,
            sessionId,
            patientId,
            'routine dental cleaning',
            nowIso,
            JSON.stringify(['D1110']),
            JSON.stringify([{ code: 'Z01.20', description: 'Dental exam' }])
          );
      }
      db.upsertTriageSession?.({
        session_id: sessionId,
        patient_id: patientId,
        rag_result_id: ragId,
        target_specialty: 'Dental',
        triage_complete: 1,
        opqrst_complete: 1,
        referred_to_911: 0,
        detected_language: scenario.lang || 'en',
        intake_complete_at: nowIso
      });
    } catch (_) {}
    KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_e2e_skip_triage', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'target_specialty', 'Dental');
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    KellyToolExecutor._setSessionMeta(sessionId, 'slots_offered', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_date', d.toISOString().slice(0, 10));
    KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_time', '14:00');
  }

  let appointmentId = null;
  if (scenario.requiresExistingAppointment) {
    const appt = await fixtures.seedAppointmentForPatient({
      patientId,
      clinicId: DEFAULT_CLINIC_ID,
      patientName: seeded.patientName,
      patientPhone: seeded.phone
    });
    appointmentId = appt.appointmentId;
    KellyToolExecutor._setSessionMeta(sessionId, 'existing_appointment_id', appointmentId);
    KellyToolExecutor._setSessionMeta(sessionId, 'last_appointment_id', appointmentId);
  }

  if (scenario.copayScenario || scenario.copayPayment) {
    process.env.VOICE_ELIGIBILITY_SIMULATE = '1';
    try {
      const { saveConversationSession } = require('../services/conversation-mode/conversation-mode-session');
      saveConversationSession(sessionId, {
        conversation_mode: 'tenant_billing',
        active_subrail: 'copay_link',
        active_subrail_step: scenario.copayPayment ? 'pay_invoice' : 'payment_start',
        pivot_reason: 'eval_copay_seed'
      });
    } catch (_) {}
    if (scenario.copayPayment) {
      KellyToolExecutor._setSessionMeta(sessionId, 'patient_identity_verified', '1');
    }
  }

  let dbLanguageMode = scenario.language_mode;
  try {
    const row = db.db
      ?.prepare('SELECT language_mode FROM kelly_sessions WHERE session_id = ? LIMIT 1')
      .get(sessionId);
    if (row?.language_mode) dbLanguageMode = row.language_mode;
  } catch (_) {}

  return {
    sessionId,
    clinicId: DEFAULT_CLINIC_ID,
    customerId,
    patientId,
    patientName: seeded.patientName,
    callerPhone: seeded.phone,
    language_mode: scenario.language_mode,
    dbLanguageMode,
    appointmentId
  };
}

function automatedPassFromFindings(findings, assertionVacuous) {
  if (assertionVacuous) return false;
  const actionable = findings.filter((f) => !f.optional);
  return actionable.length > 0 && actionable.every((f) => f.pass);
}

async function runScenarioOnce(scenario) {
  scenario = resolveMultilangScenario(scenario);
  if (!driver.hasLlmKey()) {
    return {
      id: scenario.id,
      skipped: true,
      reason: 'no_llm_key',
      automatedPass: true
    };
  }

  let ctx;
  try {
    ctx = await prepareScenario(scenario);
  } catch (err) {
    return {
      id: scenario.id,
      error: `prepareScenario: ${err.message}`,
      findings: [{ pass: false, check: 'prepareScenario', got: err.message }],
      automatedPass: false,
      assertionVacuous: false,
      findingCount: 1
    };
  }

  let result;
  try {
    result = await driver.driveConversation(ctx, scenario.utterances, scenario);
  } catch (err) {
    fixtures.teardownMultilangScenario({
      sessionId: ctx.sessionId,
      appointmentId: ctx.appointmentId,
      patientId: ctx.patientId
    });
    return {
      id: scenario.id,
      error: err.message,
      findings: [{ pass: false, check: 'driveConversation', got: err.message }],
      automatedPass: false,
      assertionVacuous: false,
      findingCount: 1
    };
  }

  const db = require('../database');
  const { findings, assertionVacuous, findingCount } = checkAssertions(scenario, result, {
    sessionId: ctx.sessionId,
    dbModule: db
  });

  if (scenario.copayScenario || scenario.copayPayment) {
    const lastCopay = result.sessionMeta?.last_copay_due;
    const payTool = result.toolsUsed?.includes('request_patient_payment');
    const needsParity = isCopayPaymentScenario(scenario) || scenario.checkSessionDeskParity;
    if (needsParity && (payTool || (lastCopay != null && String(lastCopay).trim() !== ''))) {
      const parity = assertSessionCopayParity({
        sessionId: ctx.sessionId,
        patientId: ctx.patientId,
        clinicId: ctx.clinicId
      });
      findings.push({
        pass: parity.ok || !parity.paymentAmount,
        check: 'session desk parity (voice quote vs desk)',
        got: parity
      });
    }
    if (isCopayPaymentScenario(scenario)) {
      findings.push({
        pass: payTool,
        check: 'request_patient_payment on copay payment scenario',
        got: result.toolsUsed
      });
      const payToken = result.sessionMeta?.rcm_pay_token;
      findings.push({
        pass: !!payToken,
        check: 'rcm_pay_token in session after payment turn',
        got: payToken ? String(payToken).slice(0, 12) + '…' : null
      });
      try {
        const smsRow = db.db
          ?.prepare(
            `SELECT payload_json FROM kelly_call_events
             WHERE (session_id = ? OR call_id = ?) AND event_type = 'payment_link_sent'
             LIMIT 1`
          )
          .get(ctx.sessionId, ctx.sessionId);
        findings.push({
          pass: !!smsRow || !!payToken,
          check: 'payment_link_sent event or pay token (SMS +1555 optional)',
          optional: !smsRow && !!payToken,
          got: !!smsRow
        });
      } catch (_) {}
    }
    if (scenario.expectedTools?.includes('collect_insurance')) {
      const collected = result.toolsUsed?.includes('collect_insurance');
      findings.push({
        pass: collected,
        check: 'collect_insurance on copay scenario',
        got: result.toolsUsed
      });
    }
  }

  fixtures.teardownMultilangScenario({
    sessionId: ctx.sessionId,
    appointmentId: ctx.appointmentId,
    patientId: ctx.patientId
  });

  let eligibilityLog = null;
  if ((scenario.copayScenario || isCopayPaymentScenario(scenario)) && db.db) {
    try {
      const row = db.db
        .prepare(
          `SELECT eligibility_quality, copay_amount, eligible, response_data, created_at
           FROM eligibility_checks WHERE patient_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`
        )
        .get(ctx.patientId);
      if (row) {
        let source = 'simulate';
        try {
          const rd = row.response_data ? JSON.parse(row.response_data) : {};
          if (rd.stedi || rd.source === 'stedi') source = 'stedi';
        } catch (_) {}
        eligibilityLog = {
          eligibility_quality: row.eligibility_quality,
          copay_amount: row.copay_amount,
          eligible: row.eligible,
          source
        };
        console.log(`    [eligibility] ${scenario.id}:`, eligibilityLog);
      }
    } catch (_) {}
  }

  const pass = automatedPassFromFindings(findings, assertionVacuous);

  return {
    id: scenario.id,
    lang: scenario.lang,
    intent: scenario.intent,
    persona: scenario.persona,
    utterances: scenario.utterances,
    toolsUsed: result.toolsUsed,
    forceLanguageHandoff: result.forceLanguageHandoff,
    finalReply: result.finalReply,
    fullTranscript: result.transcript,
    sessionMeta: result.sessionMeta,
    runMeta: {
      ...result.runMeta,
      scenario_registry_hash: registryHash(),
      language_mode_db: ctx.dbLanguageMode,
      eval_run_index: result.runMeta?.eval_run_index,
      eligibility_log: eligibilityLog
    },
    findings,
    assertionVacuous,
    findingCount: findings.filter((f) => !f.optional).length,
    automatedPass: pass,
    humanReview: { toneScore: null, naturalness: null, notes: '' }
  };
}

function majorityPass(runs) {
  const valid = runs.filter((r) => !r.skipped && !r.error);
  if (!valid.length) return { majorityPass: false, passCount: 0, runCount: 0 };
  const passCount = valid.filter((r) => r.automatedPass).length;
  const needed = Math.ceil(MAJORITY_RUNS / 2);
  return {
    majorityPass: passCount >= needed,
    passCount,
    runCount: valid.length,
    needed,
    runs: valid.map((r) => ({ automatedPass: r.automatedPass, eval_run_index: r.runMeta?.eval_run_index }))
  };
}

async function runScenario(scenario) {
  if (EVAL_RUNS <= 1) {
    return runScenarioOnce(scenario);
  }

  const runs = [];
  for (let i = 0; i < EVAL_RUNS; i++) {
    const run = await runScenarioOnce(scenario);
    run.runMeta = { ...(run.runMeta || {}), eval_run_index: i + 1 };
    runs.push(run);
    fs.writeFileSync(
      path.join(OUT_DIR, `${scenario.id}.run${i + 1}.json`),
      JSON.stringify(run, null, 2)
    );
  }

  const majority = majorityPass(runs);
  const last = runs[runs.length - 1];
  return {
    ...last,
    evalRuns: EVAL_RUNS,
    majority,
    automatedPass: majority.majorityPass,
    runsSummary: majority.runs
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { lang, intent, scenario: scenarioId, tag } = parseArgs();
  let selected = listMultilangScenarios({ lang, intent, id: scenarioId, tag });
  if (!selected.length) selected = MULTILANG_SCENARIOS;

  driver.preflightOrThrow({ requireServer: process.env.RCM_E2E_USE_EXISTING_SERVER === '1' });

  console.log(`Running ${selected.length} multilang scenario(s) (${EVAL_RUNS} run(s) each)…\n`);
  const results = [];
  for (const scenario of selected) {
    const resolved = resolveMultilangScenario(scenario);
    process.stdout.write(`  ${resolved.id}… `);
    const result = await runScenario(resolved);
    results.push(result);
    const label = result.skipped ? 'SKIP' : result.automatedPass ? 'PASS' : 'REVIEW';
    console.log(label);
    fs.writeFileSync(path.join(OUT_DIR, `${resolved.id}.json`), JSON.stringify(result, null, 2));
  }

  const automatedPass = results.filter((r) => r.automatedPass && !r.skipped).length;
  const passRateByTag = {};
  for (const r of results) {
    const scenario = getScenarioById(r.id) || MULTILANG_SCENARIOS.find((s) => s.id === r.id);
    const tags = scenario?.evalTags || ['untagged'];
    for (const t of tags) {
      if (!passRateByTag[t]) passRateByTag[t] = { total: 0, pass: 0 };
      passRateByTag[t].total++;
      if (r.automatedPass && !r.skipped) passRateByTag[t].pass++;
    }
  }
  const summary = {
    total: results.length,
    automatedPass,
    passRateByTag,
    note:
      'Headline pass count includes eligibility-only copay scenarios unless filtered by --tag=copay_payment',
    needsHumanReview: results.filter((r) => !r.skipped).length,
    registry_hash: registryHash(),
    eval_runs: EVAL_RUNS,
    majority_runs_threshold: MAJORITY_RUNS,
    strict: STRICT,
    byLanguage: {},
    scenarios: results.map((r) => ({
      id: r.id,
      automatedPass: r.automatedPass,
      skipped: !!r.skipped,
      assertionVacuous: r.assertionVacuous,
      findingCount: r.findingCount,
      majority: r.majority || null
    }))
  };
  for (const r of results) {
    summary.byLanguage[r.lang || 'unknown'] = summary.byLanguage[r.lang || 'unknown'] || { total: 0, pass: 0 };
    summary.byLanguage[r.lang || 'unknown'].total++;
    if (r.automatedPass) summary.byLanguage[r.lang || 'unknown'].pass++;
  }
  fs.writeFileSync(path.join(OUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\nAutomated: ${automatedPass}/${results.length} passed.`);
  if (Object.keys(passRateByTag).length) {
    console.log('Pass rate by tag:');
    for (const [tagName, stats] of Object.entries(passRateByTag)) {
      console.log(`  ${tagName}: ${stats.pass}/${stats.total}`);
    }
  }
  if (EVAL_RUNS > 1) {
    console.log(`Majority gate: ${MAJORITY_RUNS}-run threshold for ticket evidence (MULTILANG_MAJORITY_RUNS).`);
  }
  console.log('Automated pass ≠ language quality sign-off for ES/RU.');
  console.log(`Transcripts: ${OUT_DIR}`);

  if (STRICT && results.some((r) => !r.automatedPass && !r.skipped)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runScenario, main, checkAssertions, resolveMultilangScenario };
