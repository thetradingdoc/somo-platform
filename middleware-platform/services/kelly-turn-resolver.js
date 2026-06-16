'use strict';

const KellyAgentService = require('./kelly-agent-service');
const KellyConversationGraph = require('./kelly-conversation-graph');
const { runKellyConversationTurn } = require('./kelly-conversation-bridge');
const { handleTurn } = require('./kelly-rails/orchestrator');
const db = require('../database');
const { evaluateFirstTurnLanguage } = require('./kelly-rails/language');
const { emitLanguageMismatch } = require('./kelly-language-telemetry');
const {
  isProductionKellyEnforced,
  isHybridGraphAllowed,
  isLegacyProcessTurnAllowed,
  shouldUseKellyRailsV2Production,
  logBlockedRuntime
} = require('./kelly-rails/runtime-guard');
const { isKellyRailsV2Enabled } = require('./kelly-rails/config');
const { recordCallStarted, recordCallCompleted } = require('./kelly-call-telemetry');

function recordKellyLlmUsage(opts = {}, out = {}, latencyMs = 0) {
  try {
    const usage = out?.usage || out?.llm_usage || out?.kelly_rails?.usage || {};
    const tokensIn = usage.prompt_tokens ?? usage.input_tokens ?? usage.tokens_in ?? null;
    const tokensOut = usage.completion_tokens ?? usage.output_tokens ?? usage.tokens_out ?? null;
    if (!tokensIn && !tokensOut && !latencyMs) return;
    db.insertLlmUsageLog?.({
      call_id: opts.callId || opts.sessionId || null,
      clinic_id: opts.clinicId || null,
      customer_id: opts.customerId || null,
      operation: 'kelly_voice_turn',
      model: usage.model || out?.model || 'kelly',
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: usage.cost_usd ?? null,
      latency_ms: latencyMs || null,
      confidence_score: out?.languageConfidence ?? null
    });
    try {
      const { recordAssistantLatency } = require('./voice-speech-metrics');
      recordAssistantLatency({ callId: opts.callId || opts.sessionId, latencyMs });
    } catch (_) {}
  } catch (e) {
    console.warn('[kelly-turn] llm usage log skipped:', e.message);
  }
}

function productionRuntimeError(attemptedRuntime) {
  const err = new Error(
    `Kelly runtime "${attemptedRuntime}" is disabled in production. Set KELLY_RAILS_V2=1 and KELLY_RAILS_ROLLOUT_PCT=1.`
  );
  err.code = 'KELLY_RUNTIME_BLOCKED';
  err.runtime = attemptedRuntime;
  return err;
}

/**
 * Single Kelly conversation turn — priority: KELLY_RAILS_V2 → hybrid graph+processTurn → legacy.
 */
async function runKellyTurn(opts = {}) {
  const sessionId = String(opts.sessionId || '').trim();
  const clinicId = opts.clinicId || null;
  const message = String(opts.message || opts.userMessage || '').trim();
  const channel = opts.channel || 'chat';
  const turnReceivedAt = opts.turnReceivedAt || Date.now();

  try {
    const prior = db.listKellyCallEvents?.({ session_id: sessionId, limit: 20 }) || [];
    if (sessionId && !prior.some((e) => e.event_type === 'call_started')) {
      recordCallStarted({
        session_id: sessionId,
        call_id: opts.callId || null,
        channel,
        runtime: 'kelly_rails_v2',
        clinic_id: clinicId || null,
        patient_id: opts.patientId || null,
      });
    }
    db.insertKellyCallEvent?.({
      session_id: sessionId || null,
      call_id: opts.callId || null,
      event_type: 'turn_received',
      payload_json: {
        clinic_id: clinicId || null,
        patient_id: opts.patientId || null,
        channel
      }
    });
  } catch (_) {}

  let sessionLanguage = null;
  if (sessionId && message && db.getKellySessionLanguage && db.upsertKellySessionLanguage) {
    sessionLanguage = db.getKellySessionLanguage(sessionId);
    if (!sessionLanguage) {
      const detected = evaluateFirstTurnLanguage(message);
      db.upsertKellySessionLanguage(sessionId, detected.language);
      opts.preferredLanguage = detected.language;
      opts.languageConfidence = detected.confidence;
      if (detected.forceLanguageHandoff) {
        opts.forceLanguageHandoff = true;
      }
      try {
        db.insertKellyCallEvent?.({
          session_id: sessionId,
          event_type: 'language_detected',
          payload_json: {
            clinic_id: clinicId || null,
            patient_id: opts.patientId || null,
            language: detected.language,
            confidence: detected.confidence,
            channel,
            explicit_preference: !!detected.explicitPreference,
            force_language_handoff: !!detected.forceLanguageHandoff
          }
        });
      } catch (_) {}

      if (detected.forceLanguageHandoff) {
        emitLanguageMismatch(db, {
          session_id: sessionId,
          detected_language: detected.language,
          session_language: null,
          mismatch_type: 'low_confidence_first_turn',
          action_taken: 'handoff',
          channel,
          runtime: 'kelly_rails_v2'
        });
      }
    } else {
      opts.preferredLanguage = opts.preferredLanguage || sessionLanguage;
      const detected = evaluateFirstTurnLanguage(message);
      if (detected.language && detected.language !== sessionLanguage && !detected.explicitPreference) {
        emitLanguageMismatch(db, {
          session_id: sessionId,
          detected_language: detected.language,
          session_language: sessionLanguage,
          mismatch_type: 'detected_vs_session',
          action_taken: 'continue',
          channel,
          runtime: 'kelly_rails_v2'
        });
      }
    }
  }

  const locale = String(opts.preferredLanguage || sessionLanguage || 'en').slice(0, 2);
  opts.locale = locale;

  if (isProductionKellyEnforced() && !isKellyRailsV2Enabled()) {
    logBlockedRuntime(db, sessionId, 'kelly_rails_v2', 'v2_flag_off_in_production');
    throw productionRuntimeError('kelly_rails_v2_disabled');
  }

  if (sessionId && shouldUseKellyRailsV2Production(sessionId, clinicId)) {
    opts.db = opts.db || db;
    const out = await handleTurn(opts);
    const latencyMs = Math.max(0, Date.now() - turnReceivedAt);
    const lane = out?.kelly_rails?.active_lane || null;
    const step = out?.kelly_rails?.step || null;
    const flags = out?.kelly_rails?.flags || {};
    try {
      db.insertKellyCallEvent?.({
        session_id: sessionId || null,
        call_id: opts.callId || null,
        event_type: 'turn_resolved',
        payload_json: {
          runtime: 'kelly_rails_v2',
          clinic_id: clinicId || null,
          patient_id: opts.patientId || null,
          lane,
          step,
          tools_used: out?.toolsUsed || [],
          language: out?.language || locale,
          locale,
          latency_ms: latencyMs
        }
      });
      if (out?.endCall) {
        const disposition = flags.safety_blocked
          ? 'escalated'
          : flags.payment_complete
            ? 'paid'
            : flags.pending_human_handoff
              ? 'handoff'
              : 'completed';
        recordCallCompleted({
          session_id: sessionId,
          call_id: opts.callId || null,
          channel,
          runtime: 'kelly_rails_v2',
          final_lane: lane,
          final_step: step,
          disposition,
          guardrail_count: flags.safety_blocked ? 1 : 0,
          turn_count: 1
        });
      }
    } catch (_) {}
    recordKellyLlmUsage(opts, out, latencyMs);
    return out;
  }

  if (
    isHybridGraphAllowed() &&
    sessionId &&
    KellyConversationGraph.shouldUseKellyGraph(sessionId, clinicId)
  ) {
    const out = await runKellyConversationTurn(opts);
    const hybridLatencyMs = Math.max(0, Date.now() - turnReceivedAt);
    try {
      db.insertKellyCallEvent?.({
        session_id: sessionId || null,
        call_id: opts.callId || null,
        event_type: 'turn_resolved',
        payload_json: {
          runtime: 'hybrid_graph',
          clinic_id: clinicId || null,
          patient_id: opts.patientId || null,
          tools_used: out?.toolsUsed || [],
          locale,
          latency_ms: hybridLatencyMs
        }
      });
    } catch (_) {}
    recordKellyLlmUsage(opts, out, hybridLatencyMs);
    return out;
  }

  if (isProductionKellyEnforced()) {
    if (KellyConversationGraph.shouldUseKellyGraph(sessionId, clinicId)) {
      logBlockedRuntime(db, sessionId, 'hybrid_graph', 'hybrid_disabled_in_production');
      throw productionRuntimeError('hybrid_graph');
    }
    logBlockedRuntime(db, sessionId, 'legacy_process_turn', 'legacy_disabled_in_production');
    throw productionRuntimeError('legacy_process_turn');
  }

  if (!isLegacyProcessTurnAllowed()) {
    logBlockedRuntime(db, sessionId, 'legacy_process_turn', 'legacy_explicitly_disabled');
    throw productionRuntimeError('legacy_process_turn');
  }

  const out = await KellyAgentService.processTurn(opts);
  const legacyLatencyMs = Math.max(0, Date.now() - turnReceivedAt);
  try {
    db.insertKellyCallEvent?.({
      session_id: sessionId || null,
      call_id: opts.callId || null,
      event_type: 'turn_resolved',
      payload_json: {
        runtime: 'legacy_process_turn',
        clinic_id: clinicId || null,
        patient_id: opts.patientId || null,
        tools_used: out?.toolsUsed || [],
        locale,
        latency_ms: legacyLatencyMs
      }
    });
  } catch (_) {}
  recordKellyLlmUsage(opts, out, legacyLatencyMs);
  return out;
}

module.exports = { runKellyTurn };
