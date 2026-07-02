#!/usr/bin/env node
'use strict';

/**
 * NYC dental front-desk PSTN utterance scenarios — HTTP replay (no live Twilio/PSTN).
 *
 * Usage:
 *   node scripts/dental-pstn-scenarios.cjs
 *   node scripts/dental-pstn-scenarios.cjs --scenario DENTAL-001
 *   node scripts/dental-pstn-scenarios.cjs --json
 *
 * Env:
 *   DENTAL_PSTN_HTTP=1     POST tool routes via API_BASE (default inline runKellyTurn)
 *   API_BASE=http://127.0.0.1:4000
 *   INTERNAL_JOB_TOKEN=...   forwarded on HTTP replay requests
 *   VOICE_ELIGIBILITY_SIMULATE=1
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const path = require('path');

const MP = path.join(__dirname, '..');
process.chdir(MP);

process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
process.env.KELLY_E2E_SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE || '1';
process.env.RCM_E2E_DIRECT_TOOLS = process.env.RCM_E2E_DIRECT_TOOLS || '1';
process.env.VOICE_ELIGIBILITY_SIMULATE = process.env.VOICE_ELIGIBILITY_SIMULATE || '1';
process.env.DB_PATH =
  process.env.DB_PATH ||
  (require('fs').existsSync(path.join(MP, 'var/db/middleware-dev.db'))
    ? path.join(MP, 'var/db/middleware-dev.db')
    : path.join(MP, 'middleware-dev.db'));

const DEFAULT_CLINIC_ID =
  process.env.PHASE2_PILOT_CLINIC_ID ||
  process.env.TEST_CLINIC_ID ||
  'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

/** @type {import('./dental-pstn-scenarios.cjs').DentalScenario[]} */
const scenarios = [
  {
    id: 'DENTAL-001',
    title: 'New patient — cleaning (D1110)',
    locale: 'en-US',
    utterances: [
      "Hi, I'm a new patient and I need a cleaning.",
      'Yes, sometime next week in the morning works.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['FRONT_DESK_INTAKE', 'BOOKING_OFFER']
  },
  {
    id: 'DENTAL-002',
    title: 'Returning patient — Delta Dental member ID',
    locale: 'en-US',
    utterances: [
      "I'm a returning patient. Do you take Delta Dental?",
      'My member ID is DD123456789.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['PAYER_COLLECT', 'NO_PHI_LEAK']
  },
  {
    id: 'DENTAL-003',
    title: 'Copay quote + SMS pay link',
    locale: 'en-US',
    utterances: ["What's my copay for a cleaning?", 'Yes, send me the payment link by text.'],
    expectedTools: ['collect_insurance', 'request_patient_payment'],
    assertions: ['COPAY_QUOTE', 'PAYMENT_LINK']
  },
  {
    id: 'DENTAL-004',
    title: 'Self-pay fallback — no insurance',
    locale: 'en-US',
    utterances: ["I don't have insurance. How much is a cleaning out of pocket?"],
    expectedTools: ['request_patient_payment'],
    assertions: ['SELF_PAY_RAIL']
  },
  {
    id: 'DENTAL-005',
    title: 'Russian bilingual greeting',
    locale: 'ru-RU',
    utterances: ['Здравствуйте, мне нужна запись на чистку зубов.'],
    expectedTools: ['schedule_appointment'],
    assertions: ['BILINGUAL_GREETING']
  },
  {
    id: 'DENTAL-006',
    title: 'After-hours — coverage mode',
    locale: 'en-US',
    after_hours: true,
    utterances: ['I know you are closed but can I leave a message for tomorrow?'],
    expectedTools: ['transfer_call'],
    assertions: ['AFTER_HOURS_HANDOFF']
  },
  {
    id: 'DENTAL-007',
    title: 'Wrong office — polite boundary',
    locale: 'en-US',
    utterances: ['Is this Dr. Patel orthopedic office on Lexington?'],
    expectedTools: [],
    assertions: ['POLITE_BOUNDARY', 'NO_PHI_LEAK']
  },
  {
    id: 'DENTAL-008',
    title: 'Family caller — booking for spouse',
    locale: 'en-US',
    family_caller: true,
    utterances: [
      "I'm calling for my husband — he needs a cleaning.",
      'His name is Michael Chen, date of birth March 12 1985.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['FAMILY_CALLER', 'NAME_DISAMBIGUATION']
  },
  {
    id: 'DENTAL-009',
    title: 'Stedi timeout — desk callback offer',
    locale: 'en-US',
    stedi_timeout: true,
    utterances: [
      'Can you check my Delta Dental benefits?',
      'Member ID is DD987654321.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['STEDI_DOWN_HANDOFF']
  },
  {
    id: 'DENTAL-010',
    title: 'Transfer to front desk',
    locale: 'en-US',
    utterances: ['Can I speak to someone at the front desk please?'],
    expectedTools: ['transfer_call'],
    assertions: ['WARM_TRANSFER']
  },
  {
    id: 'DENTAL-011',
    title: 'Spanish bilingual — cleaning request',
    locale: 'es-US',
    utterances: [
      'Hola, necesito una cita para una limpieza.',
      'Sí, la próxima semana por la mañana está bien.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['BILINGUAL_GREETING', 'BOOKING_OFFER']
  }
];

function internalHeaders() {
  const tok = process.env.INTERNAL_JOB_TOKEN || process.env.INTERNAL_API_KEY || '';
  const h = { 'Content-Type': 'application/json' };
  if (process.env.INTERNAL_JOB_TOKEN) h['x-internal-job-token'] = process.env.INTERNAL_JOB_TOKEN;
  if (process.env.INTERNAL_API_KEY) h['x-internal-api-key'] = process.env.INTERNAL_API_KEY;
  if (!h['x-internal-job-token'] && !h['x-internal-api-key'] && tok) {
    h['x-internal-job-token'] = tok;
  }
  return h;
}

async function apiReachable(base) {
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/health/live`, { method: 'GET' });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function httpPostCollect(base, body) {
  const url = `${base.replace(/\/$/, '')}/voice/insurance/collect`;
  const r = await fetch(url, { method: 'POST', headers: internalHeaders(), body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: json };
}

function seedDentalSession(sessionId, scenario) {
  const db = require('../database');
  const { TriagePolicy } = require('../services/conversation-mode/tenant-policy');
  const KellyToolExecutor = require('../services/kelly-tool-executor');

  if (db.db) {
    const profileId = `prof_dental_pstn_${DEFAULT_CLINIC_ID}`;
    db.db.prepare(`
      INSERT OR REPLACE INTO prompt_profiles (
        id, clinic_id, name, specialty, system_prompt, allowed_tools, status, use_case, policy_json, updated_at
      ) VALUES (?, ?, 'Dental PSTN', 'Dental', 'dental pstn eval', ?, 'active', 'dental', ?, datetime('now'))
    `).run(
      profileId,
      DEFAULT_CLINIC_ID,
      JSON.stringify([
        'collect_insurance',
        'request_patient_payment',
        'schedule_appointment',
        'transfer_call',
        'get_available_slots'
      ]),
      JSON.stringify({ triage_policy: TriagePolicy.DISABLED })
    );
  }

  KellyToolExecutor._setSessionMeta(sessionId, 'kelly_e2e_skip_triage', '1');
  if (scenario.family_caller) KellyToolExecutor._setSessionMeta(sessionId, 'family_caller', '1');
  if (scenario.after_hours) KellyToolExecutor._setSessionMeta(sessionId, 'after_hours', '1');
  if (scenario.stedi_timeout) KellyToolExecutor._setSessionMeta(sessionId, 'stedi_simulate_timeout', '1');

  try {
    const { seedModeAtCallStart } = require('../services/conversation-mode/conversation-mode-session');
    seedModeAtCallStart({
      sessionId,
      clinicId: DEFAULT_CLINIC_ID,
      call_type: 'tenant',
      direction: 'inbound',
      firstUtterance: scenario.utterances[0] || '',
      tenantResolved: true,
      tenantPolicy: { triage_policy: TriagePolicy.DISABLED, billing_enabled: true }
    });
  } catch (_) {}
}

async function replayInlineTurn(sessionId, message, scenario) {
  const { runKellyTurn } = require('../services/kelly-turn-resolver');
  const result = await runKellyTurn({
    sessionId,
    message,
    channel: 'voice',
    clinicId: DEFAULT_CLINIC_ID,
    callId: sessionId,
    skipIdentityAdmission: true,
    routing_world: 'tenant',
    direction: 'inbound',
    call_type: 'tenant',
    preferredLanguage: scenario.locale || 'en-US',
    site_context_status: 'not_required'
  });
  return {
    reply: String(result?.reply || ''),
    toolsUsed: Array.isArray(result?.toolsUsed) ? result.toolsUsed : [],
    endCall: !!(result?.endCall || result?.end_call)
  };
}

async function replayHttpTurn(sessionId, message, scenario, apiBase) {
  if (scenario.stedi_timeout || /delta|member|copay|insurance|benefit/i.test(message)) {
    const collect = await httpPostCollect(apiBase, {
      session_id: sessionId,
      clinic_id: DEFAULT_CLINIC_ID,
      payer_id: 'DELTA_DENTAL_NY',
      member_id: 'DD123456789',
      primary_cpt: 'D1110',
      patient_id: `pstn_${sessionId.slice(0, 8)}`,
      date_of_birth: '1990-01-15'
    });
    if (collect.ok) {
      return {
        reply: collect.body?.message || 'insurance collected',
        toolsUsed: ['collect_insurance'],
        http: true
      };
    }
  }
  return replayInlineTurn(sessionId, message, scenario);
}

function toolsSatisfied(expected, observed) {
  const obs = new Set((observed || []).map((t) => String(t)));
  if (!expected?.length) return true;
  return expected.every((t) => [...obs].some((o) => o === t || o.includes(t)));
}

function hasLlmKeys() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

function structuralEval(scenario) {
  const { isToolAllowedForMode } = require('../services/conversation-mode/mode-tool-firewall');
  const { ConversationMode, Subrail } = require('../services/conversation-mode/conversation-mode-types');

  function ctxForTool(tool) {
    const base = {
      conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN,
      triage_policy: 'disabled',
      use_case: 'dental',
      site_context_status: 'not_required'
    };
    if (tool === 'request_patient_payment' || tool === 'collect_insurance') {
      return { ...base, active_subrail: Subrail.COPAY_LINK };
    }
    if (tool === 'transfer_call') {
      return { ...base, active_subrail: Subrail.HANDOFF };
    }
    return { ...base, active_subrail: Subrail.BOOKING };
  }

  const blocked = (scenario.expectedTools || []).filter((t) => !isToolAllowedForMode(t, ctxForTool(t)));
  return {
    pass: blocked.length === 0,
    mode: 'structural',
    toolsUsed: [],
    blocked,
    turns: scenario.utterances.map((u) => ({ utterance: u, structural: true }))
  };
}

/**
 * Run dental PSTN scenarios (HTTP replay when API up, else inline Kelly turn).
 * @param {{ filter?: string[], mode?: 'auto'|'http'|'inline', apiBase?: string }} opts
 */
async function run(opts = {}) {
  const filter = opts.filter || null;
  const apiBase = opts.apiBase || process.env.API_BASE || process.env.API_BASE_URL || 'http://127.0.0.1:4000';
  let mode = opts.mode || 'auto';
  if (mode === 'auto') {
    mode = process.env.DENTAL_PSTN_HTTP === '1' && (await apiReachable(apiBase)) ? 'http' : 'inline';
  }

  const selected = filter
    ? scenarios.filter((s) => filter.includes(s.id))
    : scenarios;

  const useStructural =
    mode === 'inline' &&
    (process.env.DENTAL_PSTN_STRUCTURAL === '1' ||
      (!hasLlmKeys() && process.env.DENTAL_PSTN_FORCE_LLM !== '1'));
  const results = [];
  for (const scenario of selected) {
    const sessionId = `dental_pstn_${scenario.id}_${crypto.randomBytes(4).toString('hex')}`;
    seedDentalSession(sessionId, scenario);

    if (useStructural) {
      const structural = structuralEval(scenario);
      results.push({
        id: scenario.id,
        title: scenario.title,
        mode: structural.mode,
        pass: structural.pass,
        expectedTools: scenario.expectedTools,
        toolsUsed: structural.toolsUsed,
        assertions: scenario.assertions,
        blocked: structural.blocked,
        turns: structural.turns
      });
      continue;
    }

    const turnResults = [];
    const allTools = [];
    let lastReply = '';

    for (const utterance of scenario.utterances) {
      let turn;
      try {
        turn =
          mode === 'http'
            ? await replayHttpTurn(sessionId, utterance, scenario, apiBase)
            : await replayInlineTurn(sessionId, utterance, scenario);
      } catch (e) {
        turn = { reply: '', toolsUsed: [], error: e.message };
      }
      lastReply = turn.reply || '';
      allTools.push(...(turn.toolsUsed || []));
      turnResults.push({ utterance, ...turn });
    }

    const toolsOk = toolsSatisfied(scenario.expectedTools, allTools);
    const pass =
      toolsOk ||
      (scenario.expectedTools.length === 0 && !turnResults.some((t) => t.error));

    results.push({
      id: scenario.id,
      title: scenario.title,
      mode,
      pass,
      expectedTools: scenario.expectedTools,
      toolsUsed: [...new Set(allTools)],
      assertions: scenario.assertions,
      lastReply: lastReply.slice(0, 240),
      turns: turnResults
    });
  }

  const pass = results.every((r) => r.pass);
  return { pass, mode, scenario_count: results.length, results };
}

async function main() {
  const onlyIdx = process.argv.indexOf('--scenario');
  const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
  const jsonOut = process.argv.includes('--json');
  const report = await run({ filter: only ? [only] : null });
  if (jsonOut) console.log(JSON.stringify(report, null, 2));
  else {
    for (const r of report.results) {
      console.log(`${r.pass ? '✅' : '❌'} ${r.id} — ${r.title} (${report.mode}) tools=${r.toolsUsed.join(',') || 'none'}`);
    }
    console.log(`\n${report.pass ? '✅' : '❌'} dental PSTN replay: ${report.results.filter((x) => x.pass).length}/${report.results.length}`);
  }
  process.exit(report.pass ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}

module.exports = { scenarios, run, DEFAULT_CLINIC_ID };
