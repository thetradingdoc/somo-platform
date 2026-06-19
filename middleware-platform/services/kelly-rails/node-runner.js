'use strict';

const LLMRouter = require('../llm-router');
const KellyToolExecutor = require('../kelly-tool-executor');
const { getAllowedToolNames, TRANSACTIONAL_GATE_TOOLS, isGateOwnedTransactionalStep } = require('./tool-allowlists');
const { laneSystemPrompt } = require('./prompts');
const { getDeterministicReply } = require('./prompts/deterministic');
const { loadHistory, appendHistory } = require('./history');
const { formatVoiceReply } = require('../voice-reply-formatter');
const { isToolAllowedForMode, logModeViolation } = require('../conversation-mode/mode-tool-firewall');
const { isOpqrstFieldGateEnabled } = require('./config');

const OFF_TOPIC_PATTERNS = [
  /\bI can also help with\b/i,
  /\bby the way\b/i,
  /\badditionally\b/i,
  /\bother services\b/i,
  /\bdid you know\b/i
];

const INVENTED_CONFIRMATION_PATTERNS = [
  /\b(appointment|visit|cita).{0,40}\b(confirm|booked|scheduled|reservad)/i,
  /\byou(?:'re| are) (all )?set\b/i,
  /\bi(?:'ve| have) (booked|scheduled|confirmed)\b/i,
  /\bpayment link (?:has been |was )?sent\b/i,
  /\byour copay\b/i,
  /\bcancel(?:led|ed|ación)\b/i
];

function stripInventedTransactionalConfirmation(reply, state = {}, toolsUsed = []) {
  if (!isGateOwnedTransactionalStep(state.active_lane, state.step, state.flags || {})) {
    return reply;
  }
  const usedTransactional = (toolsUsed || []).some((n) => TRANSACTIONAL_GATE_TOOLS.has(n));
  if (usedTransactional) return reply;
  const text = String(reply || '').trim();
  if (!text) return text;
  if (!INVENTED_CONFIRMATION_PATTERNS.some((r) => r.test(text))) return reply;
  return getDeterministicReply('gate_processing', state.locale || 'en');
}

function enforceScopeGuardrail(reply, state = {}, ctx = {}) {
  const text = String(reply || '').trim();
  if (!text) return text;
  if (!OFF_TOPIC_PATTERNS.some((r) => r.test(text))) return text;
  try {
    ctx.db?.insertKellyCallEvent?.({
      session_id: ctx.sessionId || null,
      event_type: 'scope_guardrail_triggered',
      payload_json: {
        active_subrail: state.active_subrail || state.flags?.active_subrail,
        active_subrail_step: state.active_subrail_step || state.flags?.active_subrail_step,
        truncated: true
      }
    });
  } catch (_) {}
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.endsWith('.') || firstSentence.endsWith('!') || firstSentence.endsWith('?')
    ? firstSentence
    : `${firstSentence}.`;
}

const MAX_ITERATIONS = parseInt(process.env.KELLY_RAILS_MAX_TOOL_ITERATIONS || '2', 10);
const KELLY_CHAT_MAX_TOKENS = parseInt(process.env.KELLY_CHAT_MAX_TOKENS || '300', 10);
const KELLY_VOICE_MAX_TOKENS = parseInt(process.env.KELLY_VOICE_MAX_TOKENS || '200', 10);

function getKellyTools() {
  const agent = require('../kelly-agent-service');
  return agent.KELLY_TOOLS || [];
}

function filterTools(allTools, allowedNames) {
  const set = new Set(allowedNames);
  return allTools.filter((t) => set.has(t?.function?.name));
}

function _loadProviderCtx(ctx) {
  const { db, clinicId, customerId, providerInstructions } = ctx;
  const providerCtx = {};

  if (!db) return providerCtx;

  try {
    if (typeof db.getClinicPromptProfile === 'function') {
      const profile = db.getClinicPromptProfile(clinicId || null, customerId || null);
      if (profile) {
        if (profile.system_prompt) providerCtx.profilePrompt = profile.system_prompt;
        if (profile.specialty) providerCtx.specialty = profile.specialty;
        if (profile.allowed_tools) {
          try {
            providerCtx.allowedTools = JSON.parse(profile.allowed_tools);
          } catch (_) {
            providerCtx.allowedTools = String(profile.allowed_tools)
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
          }
        }
      }
    }

    if (clinicId && typeof db.getClinicById === 'function') {
      const clinic = db.getClinicById(clinicId);
      if (clinic?.name) providerCtx.clinicName = clinic.name;
    }
    if (customerId && typeof db.getCustomer === 'function') {
      const customer = db.getCustomer(customerId);
      if (customer?.custom_prompt && !providerCtx.profilePrompt) {
        providerCtx.customPrompt = customer.custom_prompt;
      }
      if (!providerCtx.clinicName && customer?.name) {
        providerCtx.clinicName = customer.name;
      }
    }

    if (providerInstructions && !providerCtx.profilePrompt && !providerCtx.customPrompt) {
      providerCtx.customPrompt = providerInstructions;
    }
  } catch (err) {
    console.warn('[node-runner] Failed to load provider context:', err.message);
  }

  return providerCtx;
}

/**
 * Bounded LLM + tool loop for one graph node step.
 */
async function runNodeStep(state, ctx) {
  const { sessionId, clinicId, patientId, callerPhone, channel, message } = ctx;
  const lane = state.active_lane;
  const step = state.step;

  const providerCtx = _loadProviderCtx(ctx);
  let allowedNames = getAllowedToolNames(lane, step, state.flags || {}, providerCtx.allowedTools);
  const modeCtx = {
    conversation_mode: state.conversation_mode || state.flags?.conversation_mode,
    active_subrail: state.active_subrail || state.flags?.active_subrail,
    sessionId,
    step,
    _opqrst_gate: state.flags?._opqrst_gate,
    allowStoreOpqrst: !!state.flags?._opqrst_gate?.allowStoreOpqrst
  };
  allowedNames = allowedNames.filter((n) => isToolAllowedForMode(n, modeCtx));
  if (isOpqrstFieldGateEnabled()) {
    const gate = state.flags?._opqrst_gate;
    if (gate?.active && !gate.allowStoreOpqrst) {
      allowedNames = allowedNames.filter((n) => n !== 'store_triage_opqrst');
    }
  }
  if (allowedNames.length === 0) allowedNames = ['get_triage_session'];
  const allTools = getKellyTools();
  const tools = filterTools(allTools, allowedNames);

  appendHistory(sessionId, 'user', message);
  const history = loadHistory(sessionId);
  const systemContent = laneSystemPrompt(lane, step, { ...state, locale: state.locale || ctx.locale }, providerCtx);
  const maxTok = channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS;

  let messages = [{ role: 'system', content: systemContent }, ...history];
  const toolsUsed = [];
  let reply = '';
  let endCall = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response;
    try {
      response = await LLMRouter.call({
        messages,
        tools: tools.length ? tools : undefined,
        channel,
        maxTokens: maxTok
      });
    } catch (e) {
      console.warn('[kelly-rails] LLM call failed:', e.message);
      reply =
        channel === 'voice'
          ? state.locale === 'es'
            ? 'Tengo un problema técnico. Un momento, por favor.'
            : "I'm having trouble right now. Please hold on a moment."
          : state.locale === 'es'
            ? 'No estoy disponible por un momento. Inténtelo de nuevo.'
            : "I'm temporarily unavailable. Please try again in a moment.";
      break;
    }

    const choice = response?.choices?.[0];
    const msg = choice?.message;
    if (!msg) break;

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        if (!name || !allowedNames.includes(name)) continue;
        if (!isToolAllowedForMode(name, modeCtx)) {
          logModeViolation(ctx.db, { ...modeCtx, toolName: name, callId: sessionId });
          continue;
        }
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch (_) {}
        const result = await KellyToolExecutor.execute(name, args, {
          sessionId,
          clinicId,
          patientId,
          callerPhone,
          channel
        });
        if (!result || result.success === false || result.error) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              ToolError: result?.error || 'tool_failed',
              success: false
            }).slice(0, 4000)
          });
        } else {
          toolsUsed.push(name);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result).slice(0, 4000)
          });
        }
      }
      continue;
    }

    reply = String(msg.content || '').trim();
    break;
  }

  if (!reply) {
    reply =
      state.locale === 'es'
        ? 'Gracias — sigo trabajando en eso. ¿Puede contarme un poco más?'
        : 'Thanks — I am still working on that. Could you tell me a bit more?';
  }

  if (channel === 'voice') {
    reply = formatVoiceReply(reply, state);
  }

  reply = stripInventedTransactionalConfirmation(reply, state, toolsUsed);
  reply = enforceScopeGuardrail(reply, state, { ...ctx, db: ctx.db });

  appendHistory(sessionId, 'assistant', reply);
  return { reply, toolsUsed, endCall };
}

module.exports = { runNodeStep, filterTools, getKellyTools, enforceScopeGuardrail, stripInventedTransactionalConfirmation };
