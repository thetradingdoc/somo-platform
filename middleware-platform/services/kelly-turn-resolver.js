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

function emitKellyCallEvent(payload = {}) {
  try {
    db.insertKellyCallEvent?.(payload);
  } catch (_) {}
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
    emitKellyCallEvent({
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
  if (sessionId && db.getKellySessionLanguage && db.upsertKellySessionLanguage) {
    sessionLanguage = db.getKellySessionLanguage(sessionId);
    const explicitLocale = opts.preferredLanguage ? String(opts.preferredLanguage).slice(0, 2) : null;
    if (!sessionLanguage) {
      if (explicitLocale) {
        db.upsertKellySessionLanguage(sessionId, explicitLocale);
        opts.preferredLanguage = explicitLocale;
      } else if (message) {
        const detected = evaluateFirstTurnLanguage(message);
        db.upsertKellySessionLanguage(sessionId, detected.language);
        opts.preferredLanguage = detected.language;
        opts.languageConfidence = detected.confidence;
        if (detected.forceLanguageHandoff) {
          opts.forceLanguageHandoff = true;
        }
        emitKellyCallEvent({
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
      }
    } else {
      opts.preferredLanguage = explicitLocale || sessionLanguage;
      if (message) {
        const detected = evaluateFirstTurnLanguage(message);
        if (detected.language && detected.language !== sessionLanguage && !detected.explicitPreference && !explicitLocale) {
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
  }

  const locale = String(opts.preferredLanguage || sessionLanguage || 'en').slice(0, 2);
  opts.locale = locale;

  if (isProductionKellyEnforced() && !isKellyRailsV2Enabled()) {
    logBlockedRuntime(db, sessionId, 'kelly_rails_v2', 'v2_flag_off_in_production');
    throw productionRuntimeError('kelly_rails_v2_disabled');
  }

  if (sessionId && shouldUseKellyRailsV2Production(sessionId, clinicId)) {
    opts.db = opts.db || db;

    let convResult = null;
    try {
      const { runConversationDispatch, emitDisposition } = require('./conversation-mode/conversation-mode-session');
      convResult = await runConversationDispatch({
        sessionId,
        message,
        clinicId,
        customerId: opts.customerId || null,
        callId: opts.callId || null,
        call_type: opts.call_type || null,
        direction: opts.direction || null,
        opener_delivered: opts.opener_delivered || false,
        appointmentId: opts.appointmentId || opts.appointment_id || null,
        outbound_purpose: opts.outbound_purpose || null,
        db,
        patientId: opts.patientId || null,
        patientName: opts.patientName || null,
        utterance: message
      });
      opts.conversation_mode = convResult.session?.conversation_mode || null;
      opts.active_subrail = convResult.session?.active_subrail || null;
      opts.kelly_lane_hint = convResult.dispatch?.kelly_lane_hint || null;
      opts.conversation_session = convResult.session;

      if (convResult.enforce && convResult.dispatch?.reply && convResult.dispatch.use_kelly !== true) {
        const latencyMs = Math.max(0, Date.now() - turnReceivedAt);
        const out = {
          reply: convResult.dispatch.reply,
          endCall: !!convResult.dispatch.endCall,
          toolsUsed: convResult.dispatch.toolsUsed || [],
          language: locale,
          conversation_mode: convResult.session.conversation_mode,
          active_subrail: convResult.session.active_subrail,
          kelly_rails: {
            active_lane: convResult.dispatch.kelly_lane_hint || null,
            step: convResult.dispatch.active_subrail_step || null,
            flags: convResult.dispatch.flags || convResult.session
          }
        };
        try {
          db.insertKellyCallEvent?.({
            session_id: sessionId,
            call_id: opts.callId || null,
            event_type: 'turn_resolved',
            payload_json: {
              runtime: 'conversation_mode_dispatch',
              conversation_mode: convResult.session.conversation_mode,
              active_subrail: convResult.session.active_subrail,
              pivot_reason: convResult.pivot?.pivot_reason,
              latency_ms: latencyMs
            }
          });
          if (out.endCall) {
            const disposition = emitDisposition(db, {
              sessionId,
              callId: opts.callId,
              session: convResult.session,
              disposition: convResult.dispatch.disposition
            });
            recordCallCompleted({
              session_id: sessionId,
              call_id: opts.callId || null,
              channel,
              runtime: 'conversation_mode_dispatch',
              final_lane: convResult.dispatch.kelly_lane_hint || null,
              final_step: convResult.dispatch.active_subrail_step || null,
              disposition,
              guardrail_count: 0,
              turn_count: 1
            });
          }
        } catch (_) {}
        recordKellyLlmUsage(opts, out, latencyMs);
        return out;
      }
    } catch (e) {
      console.warn('[kelly-turn] conversation mode dispatch skipped:', e.message);
    }

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
          conversation_mode: opts.conversation_mode || convResult?.session?.conversation_mode || null,
          active_subrail: opts.active_subrail || convResult?.session?.active_subrail || null,
          tools_used: out?.toolsUsed || [],
          language: out?.language || locale,
          locale,
          latency_ms: latencyMs
        }
      });
      if (out?.endCall) {
        const { resolveDispositionFromState } = require('./conversation-mode/disposition-taxonomy');
        const { emitDisposition: emitDisp } = require('./conversation-mode/conversation-mode-session');
        const disposition = emitDisp(db, {
          sessionId,
          callId: opts.callId,
          session: { flags, conversation_mode: opts.conversation_mode, active_subrail: opts.active_subrail },
          disposition: resolveDispositionFromState({ flags, conversation_mode: opts.conversation_mode })
        });
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
