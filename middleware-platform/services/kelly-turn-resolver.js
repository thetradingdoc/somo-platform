'use strict';

const KellyAgentService = require('./kelly-agent-service');
const KellyConversationGraph = require('./kelly-conversation-graph');
const { runKellyConversationTurn } = require('./kelly-conversation-bridge');
const { handleTurn } = require('./kelly-rails/orchestrator');
const db = require('../database');
const { evaluateFirstTurnLanguage } = require('./kelly-rails/language');
const { isLanguageSupported, getTenantVoiceLanguageConfig } = require('./tenant-language-config');
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
const { Handoff } = require('./conversation-mode/handoff-types');
const KellyToolExecutor = require('./kelly-tool-executor');

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
      // First-contact marker for chat so it surfaces in the provider activity feed,
      // mirroring the voice `call_opener_used` event. (Voice logs its own opener.)
      if (channel === 'chat' && !prior.some((e) => e.event_type === 'first_contact')) {
        emitKellyCallEvent({
          session_id: sessionId,
          call_id: opts.callId || null,
          event_type: 'first_contact',
          payload_json: {
            channel,
            clinic_id: clinicId || null,
            patient_id: opts.patientId || null,
            patient_name: opts.patientName || null,
            source: 'chat'
          },
          clinic_id: clinicId || null
        });
      }
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
        const tenantLang = getTenantVoiceLanguageConfig(db, {
          clinicId,
          customerId: opts.customerId || null
        });
        const detected = evaluateFirstTurnLanguage(message);
        if (
          detected.language &&
          detected.language !== 'en' &&
          !isLanguageSupported(detected.language, tenantLang.supported_languages)
        ) {
          detected.forceLanguageHandoff = true;
        }
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

  if (!opts.skipIdentityAdmission) {
    const {
      evaluateIdentityAdmission,
      emitIdentityInvalid
    } = require('./voice-identity-admission');
    const admission = evaluateIdentityAdmission({
      sessionId,
      callId: opts.callId || null,
      clinicId,
      customerId: opts.customerId || null,
      call_type: opts.call_type || null,
      direction: opts.direction || null,
      site_context_status: opts.site_context_status || null,
      tenantResolved: require('./voice-routing-world').isTenantResolvedForMode(opts.customerId),
      routing_world: opts.routing_world || null,
      preferredLanguage: locale
    });
    if (!admission.admitted) {
      emitIdentityInvalid(db, {
        sessionId,
        callId: opts.callId || null,
        clinicId,
        customerId: opts.customerId || null,
        call_type: opts.call_type || null,
        direction: opts.direction || null,
        reason: admission.reason
      });
      const { attemptEscalation } = require('./escalation-service');
      const esc = attemptEscalation(db, {
        sessionId,
        callId: opts.callId || null,
        clinicId,
        customerId: opts.customerId || null,
        reason: admission.reason || 'identity_admission_failed',
        locale: admission.locale || locale,
        reply: admission.reply
      });
      return {
        reply: esc.reply || admission.reply || '',
        transfer_number: esc.transfer_number || null,
        endCall: esc.end_call || false,
        toolsUsed: [],
        language: admission.locale || locale,
        identity_admission_failed: true,
        escalation_outcome: esc.outcome,
        kelly_rails: { active_lane: 'support', step: 'handoff', flags: { identity_invalid: true } }
      };
    }
  }

  if (sessionId) {
    KellyToolExecutor.beginTurnToolLog(sessionId);
  }

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
        routing_world: opts.routing_world || null,
        fail_closed: opts.fail_closed || false,
        tenantPolicy: opts.tenantPolicy || null,
        db,
        patientId: opts.patientId || null,
        patientName: opts.patientName || null,
        utterance: message
      });
      opts.conversation_mode = convResult.session?.conversation_mode || null;
      opts.active_subrail = convResult.session?.active_subrail || null;
      opts.kelly_lane_hint = convResult.kelly_lane_hint || convResult.dispatch?.kelly_lane_hint || null;
      opts.conversation_session = convResult.session;

      const scriptOnly =
        convResult.enforce &&
        (convResult.handoff === Handoff.SCRIPT_ONLY ||
          convResult.dispatch?.handoff === Handoff.SCRIPT_ONLY);

      if (scriptOnly && convResult.dispatch?.reply) {
        const latencyMs = Math.max(0, Date.now() - turnReceivedAt);
        const dispatchTools = convResult.dispatch?.toolsUsed || [];
        const toolContext = {
          sessionId,
          clinicId,
          patientId: opts.patientId || null,
          callerPhone: opts.callerPhone || null,
          channel
        };
        for (const tool of dispatchTools) {
          if (!tool?.name) continue;
          try {
            await KellyToolExecutor.execute(tool.name, tool.args || {}, toolContext);
          } catch (toolErr) {
            console.warn(`[kelly-turn] scriptOnly tool ${tool.name} failed:`, toolErr.message);
          }
        }
        const executorTools = KellyToolExecutor.getTurnToolsUsed(sessionId);
        const out = {
          reply: convResult.dispatch.reply,
          endCall: !!convResult.dispatch.endCall,
          toolsUsed: executorTools.length ? executorTools : [],
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
    const executorTools = KellyToolExecutor.getTurnToolsUsed(sessionId);
    if (executorTools.length) {
      out.toolsUsed = [...new Set([...(out?.toolsUsed || []), ...executorTools])];
    }

    if (convResult?.session && sessionId) {
      try {
        const { mergeKellyRailsIntoSession, saveConversationSession } = require('./conversation-mode/conversation-mode-session');
        const merged = mergeKellyRailsIntoSession(
          convResult.session,
          out?.kelly_rails || {},
          out?.toolsUsed || []
        );
        saveConversationSession(sessionId, merged);
        out.conversation_mode = merged.conversation_mode || out.conversation_mode;
        out.active_subrail = merged.active_subrail || out.active_subrail;
        if (out.kelly_rails) {
          out.kelly_rails.flags = { ...(out.kelly_rails.flags || {}), ...merged };
        }
      } catch (e) {
        console.warn('[kelly-turn] session merge skipped:', e.message);
      }
    }

    const latencyMs = Math.max(0, Date.now() - turnReceivedAt);
    try {
      const { emitOrchestrationTrace } = require('./voice-orchestration-trace');
      emitOrchestrationTrace(db, {
        sessionId,
        callId: opts.callId,
        routing_world: opts.routing_world || convResult?.session?.routing_world || null,
        conversation_mode: opts.conversation_mode || convResult?.session?.conversation_mode,
        active_subrail: opts.active_subrail || convResult?.session?.active_subrail,
        handoff: convResult?.handoff,
        lane: out?.kelly_rails?.active_lane,
        step: out?.kelly_rails?.step,
        gate_matched: out?.kelly_rails?.gate_matched || null,
        gate_outcome: out?.kelly_rails?.gate_outcome || null,
        tools_executed: out?.toolsUsed || [],
        runtime: 'kelly_rails_v2',
        latency_ms: latencyMs
      });
      const { emitTelemetryGapIfNeeded } = require('./orchestration-telemetry-audit');
      emitTelemetryGapIfNeeded(db, sessionId, {
        conversation_mode: opts.conversation_mode || convResult?.session?.conversation_mode,
        lane: out?.kelly_rails?.active_lane,
        step: out?.kelly_rails?.step,
        gate_matched: out?.kelly_rails?.gate_matched,
        gate_outcome: out?.kelly_rails?.gate_outcome,
        tools_executed: out?.toolsUsed || []
      });
    } catch (_) {}
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
    if (out?.kelly_rails?.flags?._opqrst_gate && !out._opqrst_gate) {
      out._opqrst_gate = out.kelly_rails.flags._opqrst_gate;
    }
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
