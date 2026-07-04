'use strict';

/**
 * Production-path conversation driver — wraps runKellyTurn (not KellyAgent.processTurn).
 */

const { execSync } = require('child_process');
const { runKellyTurn } = require('../../services/kelly-turn-resolver');
const { recordCallCompleted } = require('../../services/kelly-call-telemetry');
const fixtures = require('./kelly-conversation-fixtures.cjs');
const KellyToolExecutor = require('../../services/kelly-tool-executor');

function applyDentalEvalEnvDefaults() {
  process.env.KELLY_RAILS_V2 = process.env.KELLY_RAILS_V2 || '1';
  process.env.KELLY_RAILS_ROLLOUT_PCT = process.env.KELLY_RAILS_ROLLOUT_PCT || '1';
  process.env.CONVERSATION_MODE_ROUTING = process.env.CONVERSATION_MODE_ROUTING || 'enforce';
  process.env.KELLY_E2E_SKIP_TRIAGE = process.env.KELLY_E2E_SKIP_TRIAGE || '1';
  process.env.RCM_E2E_DIRECT_TOOLS = process.env.RCM_E2E_DIRECT_TOOLS || '1';
  process.env.LANGGRAPH_KELLY_ROLLOUT_PCT = process.env.LANGGRAPH_KELLY_ROLLOUT_PCT || '0';
  if (process.env.copayScenario === '1' || process.env.VOICE_ELIGIBILITY_SIMULATE === '1') {
    process.env.VOICE_ELIGIBILITY_SIMULATE = '1';
  }
}

function hasLlmKey() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

function buildRunMeta(ctx, scenario) {
  let gitSha = process.env.GIT_SHA || null;
  if (!gitSha) {
    try {
      gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch (_) {}
  }
  return {
    model: process.env.KELLY_ANTHROPIC_MODEL || process.env.KELLY_GROQ_MODEL || 'kelly',
    provider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.GROQ_API_KEY ? 'groq' : 'openai',
    kelly_rails_v2: process.env.KELLY_RAILS_V2 === '1',
    git_sha: gitSha,
    language_mode: scenario.language_mode || ctx.language_mode || 'en_only',
    prompt_profile_id: `prof_dental_e2e_${ctx.clinicId}`,
    scenario_id: scenario.id
  };
}

function inferEvalDisposition(scenario, { toolsUsed, forceLanguageHandoff, sessionMeta = {} }) {
  if (forceLanguageHandoff) return 'handoff';
  if (toolsUsed.includes('reschedule_appointment')) return 'rescheduled';
  if (toolsUsed.includes('schedule_appointment')) {
    const ok =
      sessionMeta.schedule_appointment_success === true ||
      sessionMeta.schedule_appointment_success === '1' ||
      sessionMeta.schedule_appointment_success === 1;
    return ok ? 'booked' : 'message_taken';
  }
  if (toolsUsed.includes('cancel_appointment')) return 'cancelled';
  if (toolsUsed.includes('request_patient_payment')) return 'copay_pending';
  if (toolsUsed.includes('collect_insurance')) return 'insurance_verified';
  if (toolsUsed.includes('transfer_call')) return 'handoff';
  if (scenario.intent === 'fallback-handling') return 'handoff';
  return 'message_taken';
}

async function driveConversation(ctx, utterances, scenario = {}) {
  applyDentalEvalEnvDefaults();
  if (scenario.copayScenario) {
    process.env.VOICE_ELIGIBILITY_SIMULATE = '1';
  }

  const transcript = [];
  const toolsUsed = [];
  let finalReply = '';
  let forceLanguageHandoff = false;
  const skipIdentity = scenario.skipIdentityAdmission !== false;

  for (const text of utterances) {
    const result = await runKellyTurn({
      sessionId: ctx.sessionId,
      message: text,
      channel: 'voice',
      clinicId: ctx.clinicId,
      customerId: ctx.customerId || null,
      callId: ctx.sessionId,
      patientId: ctx.patientId || null,
      patientName: ctx.patientName || null,
      callerPhone: ctx.callerPhone || null,
      skipIdentityAdmission: skipIdentity,
      routing_world: 'tenant',
      direction: 'inbound',
      call_type: 'tenant',
      preferredLanguage: scenario.locale || null,
      site_context_status: 'not_required'
    });

    const reply = String(result?.reply || '');
    finalReply = reply;
    if (result?.forceLanguageHandoff || result?.kelly_rails?.flags?.language_handoff) {
      forceLanguageHandoff = true;
    }
    const turnTools = Array.isArray(result?.toolsUsed) ? result.toolsUsed : [];
    toolsUsed.push(...turnTools);
    transcript.push({ role: 'user', text });
    transcript.push({ role: 'assistant', text: reply, toolsUsed: turnTools });
  }

  const sessionMeta = {};
  for (const key of [
    'quote_delivered',
    'last_quote_status',
    'last_copay_due',
    'copay_amount',
    'patient_identity_verified',
    'resolved_patient_id',
    'eligibility_quality',
    'rcm_pay_token',
    'rcm_payment_id',
    'rcm_pay_sms_body',
    'cancel_complete',
    'last_appointment_id',
    'schedule_appointment_success',
    'payment_complete'
  ]) {
    const val = KellyToolExecutor._getSessionMeta(ctx.sessionId, key);
    if (val != null) sessionMeta[key] = val;
  }

  try {
    const db = require('../../database');
    const row = db.db
      ?.prepare(
        `SELECT flags_json FROM kelly_rails_session_projection WHERE session_id = ? LIMIT 1`
      )
      .get(ctx.sessionId);
    if (row?.flags_json) {
      const flags =
        typeof row.flags_json === 'string' ? JSON.parse(row.flags_json) : row.flags_json;
      if (flags.schedule_appointment_success != null) {
        sessionMeta.schedule_appointment_success = flags.schedule_appointment_success;
      }
    }
  } catch (_) {}

  const uniqueTools = [...new Set(toolsUsed)];
  recordCallCompleted({
    session_id: ctx.sessionId,
    call_id: ctx.sessionId,
    channel: 'voice',
    disposition: inferEvalDisposition(scenario, {
      toolsUsed: uniqueTools,
      forceLanguageHandoff,
      sessionMeta
    }),
    turn_count: utterances.length
  });

  return {
    transcript,
    toolsUsed: uniqueTools,
    finalReply,
    forceLanguageHandoff,
    sessionMeta,
    runMeta: buildRunMeta(ctx, scenario)
  };
}

function preflightOrThrow({ requireServer = false } = {}) {
  applyDentalEvalEnvDefaults();
  if (!hasLlmKey()) {
    throw new Error('No LLM API key (ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY)');
  }
  if (requireServer && process.env.RCM_E2E_USE_EXISTING_SERVER !== '1') {
    throw new Error('Set RCM_E2E_USE_EXISTING_SERVER=1');
  }
}

module.exports = {
  applyDentalEvalEnvDefaults,
  driveConversation,
  preflightOrThrow,
  hasLlmKey
};
