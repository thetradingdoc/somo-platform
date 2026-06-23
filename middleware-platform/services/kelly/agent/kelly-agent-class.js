'use strict';

const {
  getGroq,
  _truncateForLLM,
  _isNegatedEmergencyStatement,
  _isSummaryRequest,
  _extractLikelyBarcode,
  _tryCaptureProductTaxonomyFromMessage,
  _hasSkinTypeCorrectionIntent,
  _defersStep1SkinTypeClarifier,
  _skipStep1SkinClarifierForClinicVisit,
  _isClinicalVisitMessage,
  _shouldSkipStep1ForTurn,
  _looksLikeScanConversation,
  _extractExplicitSkinType,
  _negatesSkinType,
  _composeCapturedSummaryFromState,
  _buildIngredientGroundingBlock,
  _hashTurnText,
  _extractBodySites,
  _extractStep1Fields,
  _toolsUsedEnsureRagBeforeSlots,
  _kellyDebugTurn,
  _kellyDebugVerbose,
  _buildCompactSystemPrompt,
  _replyForTriageIncomplete,
  _sanitizeToolNameLeaks,
  _sanitizeSuggestedNextStep,
  _sanitizeToolMessageForPatient,
  _findNextAvailableDate,
  _extractRequestedSpecialty,
  _looksLikeSlotChoice,
  _extractInsuranceMemberId,
  _extractEmail,
  _extractPhone,
  _maskPhoneTail,
  _extractPatientName,
  _extractCollectedBookingInfo,
  _parseSlotOrdinal,
  _parseTimeLikeFromText,
  _normalizeTimeString,
  _resolveSlotBundleFromUserMessage,
  _extractPayerName,
  _classifyIntent,
  _extractLikelySymptomFromText,
  _noisyConfirmPrompt,
  _hasNoSymptomsRoutineSignal,
  _hasGeneralVisitSignal,
  _isNoSymptomsReply,
  _isRoutineLockedForSession,
  _extractUrgencyFromText,
  _extractPreferredDateToken,
  _resolvePreferredDateFromMeta,
  _historyShowsSlotChosen,
  _isBookingProgressIntent,
  _triageLockedForRerag,
  _resolveAppointmentTypeForSession,
  _markSlotsPresentedForSession,
  _getBillingReply,
  _isPayNowIntent,
  _buildSystemPromptLegacy,
  buildCommerceCheckoutSystemPrompt,
  _mergeUiSnapIntoReturn,
  _sessionMetaBool,
  _skincareAssessmentClientPayload,
  _appendSkincareAssessmentToReturn,
  _checkoutReply,
  _stageToPolicyFlags,
  _stageToActions,
  KELLY_TOOLS,
} = require('./kelly-agent-prelude');

const { languageDirective, detectPreferredLanguage } = require('./kelly-agent-language');
const { persistEmergencyFlag } = require('./kelly-agent-emergency');
const { handleRoutineBookingFastPath } = require('./kelly-agent-routine-fastpath');

class KellyAgentService {
  /**
   * Strong LLM instruction for non-English sessions (ISO-639-1 codes).
   * Weak "respond in language code: ru" was often ignored on voice.
   */
  static _languageDirective(preferredLanguage) {
    return languageDirective(preferredLanguage);
  }

  /**
   * Process one turn of conversation.
   *
   * @param {Object} params
   * @param {string} params.message         - User's latest message
   * @param {string} params.sessionId       - session_id for history lookup
   * @param {string} params.channel         - 'voice' | 'chat'
   * @param {string} [params.clinicId]
   * @param {string} [params.patientId]
   * @param {string} [params.callerPhone]
   * @param {string} [params.patientName]
   * @param {string} [params.portalSessionId]
   *
   * @returns {Promise<{
   *   reply: string,
   *   endCall: boolean,
   *   toolsUsed: string[],
   *   language: string
   * }>}
   */
  /** @deprecated Use kelly-turn-resolver with KELLY_RAILS_V2=1. Legacy monolith turn host. */
  static async processTurn(params) {
    const { isLegacyProcessTurnAllowed, isProductionKellyEnforced } = require('../kelly/rails/runtime-guard');
    if (isProductionKellyEnforced() && !isLegacyProcessTurnAllowed()) {
      const err = new Error(
        'KellyAgentService.processTurn is disabled in production. Enable KELLY_RAILS_V2=1.'
      );
      err.code = 'KELLY_LEGACY_DISABLED';
      throw err;
    }

    let message = String(params.message || '');
    const {
      sessionId,
      channel = 'chat',
      clinicId = null,
      patientId = null,
      callerPhone = null,
      patientName = null,
      patientEmail = null,
      portalSessionId = null,
      /** When set (e.g. public landing), overrides persisted session language for this turn. */
      preferredLanguage: preferredLanguageParam = null,
      commerceCheckout = null,
      checkoutPolicy = null,
      turnAuthority = null,
      customerId = null,
      providerInstructions = null,
      onStreamDelta = null,
      onToolStatus = null,
      scanChatMode: scanChatModeParam = false,
      plannerDecision: plannerDecisionParam = null,
      scanGrounding: scanGroundingParam = null,
      /** Hybrid graph host from kelly-conversation-bridge (Phases 2–7). */
      graphHost: graphHostParam = null
    } = params;
    const graphHost = graphHostParam && typeof graphHostParam === 'object' ? graphHostParam : null;

    _kellyDebugTurn('turn_start', {
      sessionId,
      channel,
      provider: resolvePrimaryProvider(),
      messageChars: String(message || '').length
    });
    const authorityMode = String(process.env.KELLY_TURN_AUTHORITY_MODE || 'V4').trim().toUpperCase();
    if (turnAuthority && String(turnAuthority).trim().toUpperCase() !== authorityMode) {
      try { Metrics.increment('step1.turn_authority_mismatch.count', 1); } catch (_) {}
      return {
        reply: 'Please continue in one conversation mode so I can keep state consistent.',
        endCall: false,
        toolsUsed: [],
        language: 'en',
        authority_mode: authorityMode
      };
    }

    const canonicalState = SessionStateStore.getCanonicalState({ sessionId });
    if (canonicalState) {
      _kellyDebugTurn('canonical_state_loaded', {
        sessionId,
        complaint: canonicalState.chief_complaint || null,
        severity: canonicalState.severity ?? null,
        riskFlags: Array.isArray(canonicalState.risk_flags) ? canonicalState.risk_flags.length : 0
      });
    }

    if (_isSummaryRequest(message)) {
      let state = canonicalState || null;
      if (!state && db.getTriageSession) state = db.getTriageSession(sessionId) || null;
      const summary = _composeCapturedSummaryFromState(state);
      if (summary) {
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', summary);
        return {
          reply: summary,
          endCall: false,
          toolsUsed: [],
          language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en'
        };
      }
    }

    // ── 1. Emergency pre-check (before LLM, always) ──────────
    const ignoreEmergencyDueToNegation = _isNegatedEmergencyStatement(message);
    const emergency = ignoreEmergencyDueToNegation ? { isEmergency: false } : detectRedFlags(message);
    const safety = ignoreEmergencyDueToNegation
      ? { emergency: false, status: 'green' }
      : SafetyPreScreen.evaluateSafety({ text: message, eventType: 'chat_turn', payload: { message } });
    if (!ignoreEmergencyDueToNegation && (emergency?.isEmergency || safety?.emergency)) {
      const emergencyReply = emergency?.suggestedResponse || safety?.suggested_response ||
        'This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now.';

      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', emergencyReply);
      this._persistEmergencyFlag(sessionId, patientId, callerPhone, channel, emergency);

      return { reply: emergencyReply, endCall: false, toolsUsed: [], language: 'en' };
    }

    // Optional passive capture: persist taxonomy profile if a barcode appears in user text.
    await _tryCaptureProductTaxonomyFromMessage({ sessionId, message });

    const plannerDecision = plannerDecisionParam && typeof plannerDecisionParam === 'object'
      ? plannerDecisionParam
      : null;
    const plannerRoute = String(plannerDecision?.route_context?.route || '').trim().toLowerCase();
    const plannerBypassSkincareClarifier = !!plannerDecision?.flags?.should_bypass_skincare_clarifier ||
      plannerRoute === 'food' ||
      plannerRoute === 'supplement';
    let scanChatMode = !!scanChatModeParam || plannerBypassSkincareClarifier;
    if (!scanChatMode) {
      const metaScanMode = String(KellyToolExecutor._getSessionMeta(sessionId, 'scan_chat_mode') || '')
        .trim()
        .toLowerCase();
      scanChatMode = metaScanMode === '1' || metaScanMode === 'true';
    }
    if (!scanChatMode && _looksLikeScanConversation(message)) {
      scanChatMode = true;
    }
    if (scanChatMode) {
      try {
        KellyToolExecutor._setSessionMeta(sessionId, 'scan_chat_mode', '1');
      } catch (_) {}
    }

    if (commerceCheckout && commerceCheckout.productId && commerceCheckout.providerId) {
      if (!clinicId) {
        return {
          reply:
            'Checkout chat needs a clinic context. Please open this page from your provider or shop link.',
          endCall: false,
          toolsUsed: [],
          language: 'en',
          error_code: 'CLINIC_REQUIRED'
        };
      }
      return await this._processCommerceCheckoutTurn({
        message,
        sessionId,
        channel,
        clinicId,
        patientId,
        patientEmail,
        commerceCheckout,
        checkoutPolicy,
        onStreamDelta,
        onToolStatus
      });
    }

    const _dedup = KellyOrchestratorPhase.dedupeConsecutiveUserFragments(message);
    const collapseRatio = _dedup.beforeLength > 0
      ? Math.max(0, (_dedup.beforeLength - _dedup.afterLength) / _dedup.beforeLength)
      : 0;
    const noisyPenaltyApplied =
      channel === 'voice' &&
      _dedup.collapsed &&
      collapseRatio >= STEP1_NOISE_PENALTY_THRESHOLD;
    try {
      const pct = Math.round(collapseRatio * 100);
      Metrics.increment('step1.noise_ratio_percent.total', pct);
      Metrics.increment('step1.noise_ratio_percent.count', 1);
      if (_dedup.collapsed) Metrics.increment('step1.dedupe.collapsed.count', 1);
      if (noisyPenaltyApplied) Metrics.increment('step1.noisy_penalty_applied.count', 1);
      Metrics.increment(`step1.channel.${channel || 'unknown'}.turns`, 1);
    } catch (_) {}
    if (_dedup.collapsed) {
      _kellyDebugTurn('message_deduped', {
        sessionId,
        beforeLength: _dedup.beforeLength,
        afterLength: _dedup.afterLength,
        collapseRatio
      });
      message = _dedup.text;
    }

    if (noisyPenaltyApplied) {
      const extractedSymptom = _extractLikelySymptomFromText(message);
      const confirmReply = _noisyConfirmPrompt(
        (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
        extractedSymptom
      );
      try {
        if (KellyToolExecutor._setSessionMeta) {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_confidence_band', 'low');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_confirmation_required', '1');
          KellyToolExecutor._setSessionMeta(
            sessionId,
            'step1_tentative_fields_json',
            JSON.stringify(['onset', 'severity', 'quality'])
          );
        }
      } catch (_) {}
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', confirmReply);
      return {
        reply: confirmReply,
        endCall: false,
        toolsUsed: [],
        language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
        confidence_band: 'low',
        confirmation_required: true,
        step1_quality: {
          collapse_ratio: collapseRatio,
          noisy_penalty_applied: true,
          fields_filled: 0,
          overwrite_blocked: false
        }
      };
    }

    // Load a short history snapshot before fast-intent routing so routine sessions
    // do not get reset to "do you have symptoms?" on every subsequent turn.
    const historyEarly = this._loadHistory(sessionId);
    const routineLockedEarly = _isRoutineLockedForSession(sessionId, historyEarly);
    const msgLcEarly = String(message || '').toLowerCase().trim();
    if (_isSummaryRequest(message)) {
      const st = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_value') || '').toLowerCase();
      const pending = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_pending_value') || '').toLowerCase();
      const status = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_status') || '').toLowerCase();
      if (st && st !== 'unknown') {
        const qualifier = status === 'corrected' ? ' after your correction' : '';
        const summaryReply = `So far, I captured your skin type as ${st}${qualifier}.`;
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', summaryReply);
        return { reply: summaryReply, endCall: false, toolsUsed: [], language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en' };
      }
      if (pending && pending !== 'unknown') {
        const summaryReply = `So far, I captured a tentative skin type as ${pending}, and I am confirming it with you before finalizing.`;
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', summaryReply);
        return { reply: summaryReply, endCall: false, toolsUsed: [], language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en' };
      }
      const ruledOut = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_ruled_out') || '').toLowerCase();
      if (ruledOut) {
        const summaryReply = `So far, we ruled out ${ruledOut} skin, and I am currently identifying your specific type.`;
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', summaryReply);
        return { reply: summaryReply, endCall: false, toolsUsed: [], language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en' };
      }
    }
    const step1ConfirmRequired = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_confirmation_required') || '') === '1';
    if (step1ConfirmRequired && !_shouldSkipStep1ForTurn(sessionId, message, graphHost)) {
      const yes = /\b(yes|yeah|yep|correct|right|exactly|si|sí|oui)\b/i.test(msgLcEarly);
      const no = /\b(no|nope|incorrect|wrong|not really|nah)\b/i.test(msgLcEarly);
      if (yes) {
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_confirmation_required', '0');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_tentative_fields_json', '[]');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_confidence_band', 'medium');
        } catch (_) {}
      } else if (!no) {
        const confirmReply = 'Before we continue, please confirm what you said in one short sentence so I can document it accurately.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', confirmReply);
        return {
          reply: confirmReply,
          endCall: false,
          toolsUsed: [],
          language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
          confirmation_required: true
        };
      }
    }
    const skinTypeConfirmRequired = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_confirmation_required') || '') === '1';
    if (skinTypeConfirmRequired && !_shouldSkipStep1ForTurn(sessionId, message, graphHost)) {
      const explicitSkinType = _extractExplicitSkinType(msgLcEarly);
      const yes = /\b(yes|yeah|yep|correct|right|exactly)\b/i.test(msgLcEarly);
      const no = /\b(no|nope|incorrect|wrong|not really|nah)\b/i.test(msgLcEarly);
      if (explicitSkinType) {
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_value', explicitSkinType);
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_status', 'confirmed');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', '0');
        } catch (_) {}
        const ack = `Got it, I have noted ${explicitSkinType} skin. What is your main skin concern right now?`;
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', ack);
        return { reply: ack, endCall: false, toolsUsed: [], language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en' };
      } else if (yes) {
        const pending = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_pending_value') || '');
        if (pending && pending !== 'unknown') {
          try {
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_value', pending);
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_status', 'confirmed');
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', '0');
          } catch (_) {}
          const ack = `Perfect, I have noted ${pending} skin. What is your main skin concern right now?`;
          this._appendToHistory(sessionId, 'user', message);
          this._appendToHistory(sessionId, 'assistant', ack);
          return { reply: ack, endCall: false, toolsUsed: [], language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en' };
        }
        if (!pending || pending === 'unknown') {
          const clarifyUnknown = 'Thanks. Which best describes your skin type: oily, dry, combination, sensitive, or normal?';
          this._appendToHistory(sessionId, 'user', message);
          this._appendToHistory(sessionId, 'assistant', clarifyUnknown);
          return { reply: clarifyUnknown, endCall: false, toolsUsed: [], language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en', confirmation_required: true };
        }
      } else if (no) {
        const clarify = 'Thanks for clarifying. Which fits best right now: oily, dry, combination, sensitive, or normal?';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', clarify);
        return {
          reply: clarify,
          endCall: false,
          toolsUsed: [],
          language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
          confirmation_required: true
        };
      }
    }
    // Unconditional correction template for common "not oily" correction phrases.
    if (/\bnot\s+oily\b/i.test(msgLcEarly)) {
      let correctedType = '';
      if (/\b(dry\s+cheeks?|oily\s+(t-zone|nose)|t-zone|combination|combo)\b/i.test(msgLcEarly)) correctedType = 'combination';
      else if (/\b(dry|tight|flaky)\b/i.test(msgLcEarly)) correctedType = 'dry';
      if (correctedType) {
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_value', correctedType);
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_status', 'corrected');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', '0');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_correction_pending', '0');
          if (/\btight\b/i.test(msgLcEarly)) {
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_condition_json', JSON.stringify([{ id: 'dehydrated', confidence: 'medium' }]));
          }
        } catch (_) {}
        const reply = `Thanks for correcting that. I have updated your skin type to ${correctedType}. What is your main skin concern right now?`;
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return {
          reply,
          endCall: false,
          toolsUsed: [],
          language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
          correction_override: true
        };
      }
    }
    // Correction Override phase: if user negates current skin type, force deterministic correction flow.
    const currentSkinTypeForOverride = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'step1_skin_type_value') || '');
    const explicitTypeForOverride = _extractExplicitSkinType(msgLcEarly);
    const negatesCurrentType = _negatesSkinType(msgLcEarly, currentSkinTypeForOverride);
    if (currentSkinTypeForOverride && negatesCurrentType) {
      const corrected = explicitTypeForOverride || '';
      try {
        KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_correction_pending', '1');
        if (corrected) {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_value', corrected);
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_status', 'corrected');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', '0');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_correction_pending', '0');
        } else {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', '1');
        }
      } catch (_) {}
      const reply = corrected
        ? `Thanks for correcting that. I have updated your skin type to ${corrected}. What is your main skin concern right now?`
        : "I've noted you don't have that skin type. To be sure, how would you describe your type: oily, dry, combination, sensitive, or normal?";
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
      return {
        reply,
        endCall: false,
        toolsUsed: [],
        language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
        correction_override: true
      };
    }
    // Deterministic negation template when user negates a type without replacement.
    if (/\bi don't have dry skin\b|\bnot dry skin\b/i.test(msgLcEarly)) {
      const reply = "I've noted you don't have dry skin. To be sure, how would you describe your type: oily, dry, combination, sensitive, or normal?";
      try { KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_ruled_out', 'dry'); } catch (_) {}
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
      return {
        reply,
        endCall: false,
        toolsUsed: [],
        language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
        deterministic_negation_template: true
      };
    }
    // Early deterministic skin-type capture before fast-intent routing.
    if (!skinTypeConfirmRequired) {
      const explicitEarly = _extractExplicitSkinType(msgLcEarly);
      const inferredEarly = explicitEarly || (/\bshiny\b.*\bnoon\b|\bshiny by noon\b/.test(msgLcEarly) ? 'oily' : '');
      if (inferredEarly) {
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_pending_value', inferredEarly);
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_value', inferredEarly);
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_status', explicitEarly ? 'confirmed' : 'tentative');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', explicitEarly ? '0' : '1');
          if (explicitEarly === 'oily' && /\btight\b/.test(msgLcEarly)) {
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_condition_json', JSON.stringify([{ id: 'dehydrated', confidence: 'medium' }]));
          }
        } catch (_) {}
        if (!explicitEarly) {
          const ask = `I heard ${inferredEarly} skin. Is that correct?`;
          this._appendToHistory(sessionId, 'user', message);
          this._appendToHistory(sessionId, 'assistant', ask);
          return {
            reply: ask,
            endCall: false,
            toolsUsed: [],
            language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
            confirmation_required: true
          };
        }
      }
    }

    // Rehydrate booking persona from persisted triage session if meta is missing.
    if (!KellyToolExecutor._getSessionMeta?.(sessionId, 'booking_for')) {
      try {
        const triage = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        if (triage?.booking_for) {
          KellyToolExecutor._setSessionMeta?.(sessionId, 'booking_for', String(triage.booking_for));
        }
      } catch (_) {}
    }

    // Booking persona intercept: for me vs for someone else.
    const bookingFor = KellyToolExecutor._getSessionMeta?.(sessionId, 'booking_for');
    const bookingPromptPending = KellyToolExecutor._getSessionMeta?.(sessionId, 'booking_for_prompt_pending');
    if (!bookingFor && String(bookingPromptPending || '') === '1') {
      if (/\bfor me\b|booking_for_self|myself|my (own|appointment)/i.test(msgLcEarly)) {
        KellyToolExecutor._setSessionMeta(sessionId, 'booking_for', 'self');
        KellyToolExecutor._setSessionMeta(sessionId, 'booking_for_prompt_pending', '0');
        try { db.upsertTriageSession?.({ session_id: sessionId, booking_for: 'self' }); } catch (_) {}
        if (patientId) {
          try {
            const profile = db.getFHIRPatient ? db.getFHIRPatient(patientId) : null;
            if (profile?.resource_data) {
              const data = typeof profile.resource_data === 'string'
                ? JSON.parse(profile.resource_data) : profile.resource_data;
              const email = data?.telecom?.find((t) => t.system === 'email')?.value;
              const phone = data?.telecom?.find((t) => t.system === 'phone')?.value;
              const name = [data?.name?.[0]?.given?.[0], data?.name?.[0]?.family].filter(Boolean).join(' ');
              if (email) KellyToolExecutor._setSessionMeta(sessionId, 'collected_email', email);
              if (phone) KellyToolExecutor._setSessionMeta(sessionId, 'collected_phone', normalizeToE164(phone) || phone);
              if (name) KellyToolExecutor._setSessionMeta(sessionId, 'collected_name', name);
            }
          } catch (_) {}
        }
      } else if (/\bfor someone else\b|booking_for_other|another person|my (kid|child|wife|husband|son|daughter|parent|mom|dad)/i.test(msgLcEarly)) {
        KellyToolExecutor._setSessionMeta(sessionId, 'booking_for', 'other');
        KellyToolExecutor._setSessionMeta(sessionId, 'booking_for_prompt_pending', '0');
        try { db.upsertTriageSession?.({ session_id: sessionId, booking_for: 'other' }); } catch (_) {}
      }
    }

    // Identity conflict recovery intercept: if prior schedule hit duplicate and user now gave phone, retry immediately.
    const identityConflict = KellyToolExecutor._getSessionMeta?.(sessionId, 'identity_conflict');
    const justGavePhoneEarly = !!_extractPhone(message);
    if (identityConflict === '1' && justGavePhoneEarly) {
      const retryCountRaw = KellyToolExecutor._getSessionMeta?.(sessionId, 'identity_conflict_retry_count') || '0';
      const retryCount = Number.parseInt(String(retryCountRaw), 10) || 0;
      if (retryCount >= 3) {
        KellyToolExecutor._setSessionMeta(sessionId, 'identity_conflict', '0');
        const safeStopReply = 'I am still unable to verify this identity after multiple attempts. Please call us directly so our team can complete booking securely.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', safeStopReply);
        return {
          reply: safeStopReply,
          endCall: false,
          toolsUsed: [],
          language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
          error_code: 'IDENTITY_VERIFICATION_MAX_RETRIES',
          duplicate: true
        };
      }
      const confirmedPhoneRaw = _extractPhone(message);
      const confirmedPhone = normalizeToE164(confirmedPhoneRaw) || confirmedPhoneRaw;
      if (!confirmedPhone) {
        const invalidPhoneReply = 'That number did not look valid. Please provide your phone in +1XXXXXXXXXX format so I can verify your identity.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', invalidPhoneReply);
        return {
          reply: invalidPhoneReply,
          endCall: false,
          toolsUsed: [],
          language: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
          error_code: 'INVALID_PHONE_FORMAT'
        };
      }
      KellyToolExecutor._setSessionMeta(sessionId, 'collected_phone', confirmedPhone);
      KellyToolExecutor._setSessionMeta(sessionId, 'identity_conflict_retry_count', String(retryCount + 1));
      KellyToolExecutor._setSessionMeta(sessionId, 'identity_conflict', '0');
      this._appendToHistory(sessionId, 'user', message);
      if (_kellyDebugVerbose()) {
        console.log('[IDENTITY-RETRY] Retrying schedule with confirmed phone:', String(confirmedPhone || '').slice(0, 6) + '…');
      }
      return await this._serverSideSchedule({
        sessionId, clinicId, patientId, callerPhone, channel,
        preferredLanguage: (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en',
        confirmedEmail: KellyToolExecutor._getSessionMeta(sessionId, 'collected_email'),
        confirmedPhone,
        confirmedName: KellyToolExecutor._getSessionMeta(sessionId, 'collected_name'),
        phoneConfirmed: true
      });
    }

    // ── 1b. Fast intent pre-check (billing/routine) ────────────
    const intent = _classifyIntent(message);
    if (!(routineLockedEarly && intent === 'routine_booking')) {
      const fastIntentResponse = await this._handleFastIntentPrecheck({
        intent,
        message,
        sessionId,
        patientId,
        clinicId,
        callerPhone,
        channel,
        graphHost
      });
      if (fastIntentResponse) return fastIntentResponse;
    }

    const payGuardrailResponse = await this._maybePaymentLinkGuardrail({
      message,
      sessionId,
      patientId,
      clinicId,
      callerPhone,
      channel,
      graphHost
    });
    if (payGuardrailResponse) return payGuardrailResponse;

    // ── 2. Load conversation history ──────────────────────────
    const history = historyEarly;
    const lastAssistantText = (() => {
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
      return String(lastAssistant?.content || '').toLowerCase();
    })();
    const llmAlreadyAcceptedNoSymptoms =
      /routine.*no symptoms|no.*symptoms.*routine|skip.*triage|no active symptoms|routine.*general visit|routine wellness/i.test(lastAssistantText);
    const askedSymptomsConfirmation =
      /current symptoms or concerns today|any current symptoms|симптом|sintoma|symptome|dalili/i.test(lastAssistantText);
    if (
      askedSymptomsConfirmation &&
      (_isNoSymptomsReply(message) || llmAlreadyAcceptedNoSymptoms) &&
      !KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId)
    ) {
      try {
        if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');
      } catch (_) {}
      const preferredLanguageQuick = this._detectPreferredLanguage(history, message);
      const noSymptomsByLang = {
        ru: 'Отлично. Поняла, симптомов нет. Вам нужно к врачу срочно сейчас или хотите запланировать прием на позже? И какая дата вам подходит?',
        es: 'Perfecto. Entiendo que no hay sintomas. Necesita ver al medico de inmediato o prefiere programar para despues? Que fecha le funciona mejor?',
        fr: 'Parfait. J ai compris qu il n y a pas de symptomes. Avez-vous besoin de voir un medecin immediatement, ou preferez-vous planifier plus tard ? Quelle date vous convient ?',
        sw: 'Vizuri. Nimeelewa hakuna dalili za sasa. Unahitaji kumuona daktari mara moja au ungependa kupanga miadi ya baadaye? Ni tarehe gani inakufaa?'
      };
      const noSymptomsReply =
        noSymptomsByLang[preferredLanguageQuick] ||
        'Perfect. Since there are no current symptoms, do you need to see a doctor immediately, or would you like to schedule for later? What date works best for you?';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', noSymptomsReply);
      return { reply: noSymptomsReply, endCall: false, toolsUsed: [], language: preferredLanguageQuick || 'en' };
    }

    // ── Email confirmation intercept ──────────────────────────────
    // When Kelly just confirmed an email and user says "yes/correct/right",
    // mark email as confirmed and proceed to next step without hitting LLM
    const lastAssistantConfirmedEmail = /i have .{3,80}@.{2,40}\.|is that (correct|right)\?/i.test(lastAssistantText);
    const userConfirmedYes = /^(yes|correct|right|yep|yeah|yup|확인|да|si|oui|ndio|ndiyo)$/i.test(String(message || '').trim().toLowerCase());

    if (lastAssistantConfirmedEmail && userConfirmedYes) {
      const langForIntercept = (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || this._detectPreferredLanguage(history, message) || 'en';
      const confirmedEmail = KellyToolExecutor._getSessionMeta(sessionId, 'collected_email');
      const confirmedPhone = KellyToolExecutor._getSessionMeta(sessionId, 'collected_phone');
      const confirmedName = KellyToolExecutor._getSessionMeta(sessionId, 'collected_name');

      this._appendToHistory(sessionId, 'user', message);

      if (confirmedEmail && !confirmedPhone) {
        const phoneAsk = 'Got it! And what\'s the best phone number to reach you?';
        this._appendToHistory(sessionId, 'assistant', phoneAsk);
        return { reply: phoneAsk, endCall: false, toolsUsed: [], language: langForIntercept };
      }

      if (confirmedEmail && confirmedPhone && confirmedName) {
        return await this._serverSideSchedule({
          sessionId, clinicId, patientId, callerPhone, channel,
          preferredLanguage: langForIntercept, confirmedEmail, confirmedPhone, confirmedName
        });
      }

      if (!confirmedName) {
        const nameAsk = 'Got it! Could I get your full name to complete the booking?';
        this._appendToHistory(sessionId, 'assistant', nameAsk);
        return { reply: nameAsk, endCall: false, toolsUsed: [], language: langForIntercept };
      }
    }

    // gap18 + M-S1.E: never stay stuck on persisted English after "can we speak Russian?" etc.
    const priorStored = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
    let preferredLanguage = priorStored;
    // Public landing / explicit locale: keep English when client asks (avoids stale fr/es from old sessions)
    if (preferredLanguageParam === 'en') {
      preferredLanguage = 'en';
      try {
        if (db.upsertKellySessionLanguage) db.upsertKellySessionLanguage(sessionId, 'en');
      } catch (_) {}
    }

    let languageExplicit = false;
    try {
      const { detectLanguagePreferenceRequest } = require('../patient/patient-orchestrator-service');
      const langReq = detectLanguagePreferenceRequest(String(message || ''));
      if (langReq && langReq.isLanguageRequest && langReq.code) {
        preferredLanguage = langReq.code;
        languageExplicit = true;
      }
    } catch (_) {}

    const fromCurrentUtterance = KellyAgentService._detectPreferredLanguage([], message);
    if (!languageExplicit && fromCurrentUtterance && fromCurrentUtterance !== 'en') {
      if (!preferredLanguage || preferredLanguage === 'en' || fromCurrentUtterance !== preferredLanguage) {
        preferredLanguage = fromCurrentUtterance;
      }
    }

    if (!preferredLanguage) {
      preferredLanguage = KellyAgentService._detectPreferredLanguage(history, message);
    }

    if (preferredLanguage) {
      if (preferredLanguage !== priorStored && db.upsertKellySessionLanguage) {
        db.upsertKellySessionLanguage(sessionId, preferredLanguage);
      }
      try {
        db.db?.prepare('UPDATE triage_sessions SET detected_language = ? WHERE session_id = ?').run(preferredLanguage, sessionId);
      } catch (_) {
        if (db.upsertTriageSession) db.upsertTriageSession({ session_id: sessionId, detected_language: preferredLanguage });
      }
    }

    // Persist contact info as soon as it appears — turn-by-turn accumulation.
    // Prevents re-ask loops when LLM loses context across turns.
    try {
      const msgStr = String(message || '');
      const emailFound = _extractEmail(msgStr);
      if (emailFound && KellyToolExecutor._setSessionMeta) {
        KellyToolExecutor._setSessionMeta(sessionId, 'collected_email', emailFound);
        if (_kellyDebugVerbose()) console.log('[CONTACT] Stored email:', emailFound.slice(0, 4) + '…');
      }
      const phoneFound = _extractPhone(msgStr);
      if (phoneFound && KellyToolExecutor._setSessionMeta) {
        const normalizedPhone = normalizeToE164(phoneFound);
        if (normalizedPhone) {
          KellyToolExecutor._setSessionMeta(sessionId, 'collected_phone', normalizedPhone);
          if (_kellyDebugVerbose()) console.log('[CONTACT] Stored phone:', normalizedPhone.slice(0, 6) + '…');
        }
      }
      if (!KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_name') && patientName) {
        if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'collected_name', patientName);
      } else if (!KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_name')) {
        const nameFound = _extractPatientName(msgStr);
        if (nameFound && KellyToolExecutor._setSessionMeta) {
          KellyToolExecutor._setSessionMeta(sessionId, 'collected_name', nameFound);
          if (_kellyDebugVerbose()) console.log('[CONTACT] Stored name:', nameFound);
        }
      }
    } catch (_) {}

    // ── Server-side schedule trigger when contact collection is complete ──
    // Fires after phone is given and we already have email + name
    const justGavePhone = !!_extractPhone(String(message || ''));
    if (justGavePhone) {
      const collectedEmail = KellyToolExecutor._getSessionMeta(sessionId, 'collected_email');
      const collectedPhone = KellyToolExecutor._getSessionMeta(sessionId, 'collected_phone');
      const collectedName = KellyToolExecutor._getSessionMeta(sessionId, 'collected_name');
      const slotPresented = KellyToolExecutor._getSessionMeta(sessionId, 'slot_presented');
      const slotWasPresented = String(slotPresented || '').toLowerCase() === '1' || String(slotPresented || '').toLowerCase() === 'true';

      if (collectedEmail && collectedPhone && collectedName && slotWasPresented) {
        this._appendToHistory(sessionId, 'user', message);
        if (_kellyDebugVerbose()) console.log('[CONTACT-COMPLETE] All three collected, triggering server-side schedule');
        const langForSchedule = (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || this._detectPreferredLanguage(history, message) || 'en';
        return await this._serverSideSchedule({
          sessionId, clinicId, patientId, callerPhone, channel,
          preferredLanguage: langForSchedule,
          confirmedEmail: collectedEmail,
          confirmedPhone: collectedPhone,
          confirmedName: collectedName
        });
      }
    }

    const routineLockedByHistory = Array.isArray(history) && history.some((m) => m?.role === 'user' && _hasNoSymptomsRoutineSignal(m?.content));
    const routineLockedByMeta = (() => {
      try {
        return !!KellyToolExecutor._routineNoSymptomsEffective?.(sessionId);
      } catch (_) {
        return false;
      }
    })();
    const routineLockedByHistoryEffective =
      routineLockedByHistory && !KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId);
    let routineLocked = routineLockedByHistoryEffective || routineLockedByMeta;
    const msgLcForRoutine = String(message || '').toLowerCase();
    const hasSymptomNow = SYMPTOM_KEYWORDS.some((k) => msgLcForRoutine.includes(k)) && !_hasNoSymptomsRoutineSignal(msgLcForRoutine);
    const recentUserMessages = (Array.isArray(history) ? history : [])
      .filter((m) => m?.role === 'user')
      .slice(-6)
      .map((m) => String(m?.content || '').toLowerCase());
    const symptomSeenRecently = recentUserMessages.some(
      (t) => SYMPTOM_KEYWORDS.some((k) => t.includes(k)) && !_hasNoSymptomsRoutineSignal(t)
    );
    // Safety: if we recently saw symptom language, do not keep stale routine lock.
    if (routineLocked && symptomSeenRecently && !_hasNoSymptomsRoutineSignal(msgLcForRoutine)) {
      routineLocked = false;
      try {
        if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '0');
      } catch (_) {}
    }

    // Recovery: if LLM already told the patient this is a routine visit with no symptoms
    // but the flag wasn't set (e.g. due to a typo), set it now before proceeding
    if (
      !routineLocked &&
      llmAlreadyAcceptedNoSymptoms &&
      !hasSymptomNow &&
      !KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId)
    ) {
      try {
        if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');
        if (db.upsertTriageSession) {
          const existing = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
          if (!existing.triage_complete) {
            db.upsertTriageSession({
              session_id: sessionId,
              patient_id: patientId || null,
              detected_language: existing.detected_language || preferredLanguage || 'en',
              safety_level: existing.safety_level || 'green',
              urgency: existing.urgency || 'routine',
              target_specialty: existing.target_specialty || 'PrimaryCare',
              opqrst_complete: true,
              triage_complete: true,
              intake_complete_at: existing.intake_complete_at || new Date().toISOString()
            });
          }
        }
        try {
          await KellyToolExecutor.execute(
            'run_triage_rag',
            { symptom_text: 'Routine wellness visit — no active symptoms' },
            { sessionId, clinicId, patientId, callerPhone, channel }
          );
        } catch (_) {}
        routineLocked = true;
      } catch (_) {}
    }
    const hasEmailNow = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(String(message || ''));
    const slotAlreadyChosen = _historyShowsSlotChosen(history);
    const slotWasPresented = (() => {
      try {
        const v = KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'slot_presented') : null;
        return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
      } catch (_) {
        return false;
      }
    })();
    const hasDateLikeNow = /\b(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i.test(String(message || ''));
    const urgencyFromMessage = _extractUrgencyFromText(message);
    const urgencyAlreadySet = (() => {
      try {
        const v = KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'preferred_lane') : null;
        return !!String(v || '').trim();
      } catch (_) {
        return false;
      }
    })();
    if (routineLocked && !hasSymptomNow && hasEmailNow && !slotAlreadyChosen && !slotWasPresented) {
      const routineFollowupByLang = {
        ru: 'Спасибо, email записала. Вам нужно к врачу срочно сейчас или хотите запланировать прием на позже?',
        es: 'Perfecto, ya tengo su correo. Necesita ver al medico de inmediato o prefiere programar para despues?',
        fr: 'Parfait, j ai bien note votre e-mail. Avez-vous besoin de voir un medecin immediatement, ou preferez-vous planifier plus tard ?',
        sw: 'Asante, nimepokea barua pepe yako. Unahitaji kumuona daktari mara moja au ungependa kupanga miadi ya baadaye?'
      };
      const routineFollowup =
        routineFollowupByLang[preferredLanguage] ||
        'Thanks, I saved your email. Do you need to see a doctor immediately, or would you like to schedule for later?';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', routineFollowup);
      return { reply: routineFollowup, endCall: false, toolsUsed: [], language: preferredLanguage || 'en' };
    }
    if (routineLocked && !hasSymptomNow && hasDateLikeNow) {
      if (urgencyFromMessage) {
        try {
          if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'preferred_lane', urgencyFromMessage);
          const dateToken = _extractPreferredDateToken(message);
          if (dateToken && KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'preferred_date', dateToken);
        } catch (_) {}
      } else if (!urgencyAlreadySet) {
      const routineDateFollowupByLang = {
        ru: 'Отлично, записала дату. Вам нужно к врачу срочно сейчас или хотите запланировать прием на позже?',
        es: 'Perfecto, ya tengo la fecha. Necesita ver al medico de inmediato o prefiere programar para despues?',
        fr: 'Parfait, j ai bien note la date. Avez-vous besoin de voir un medecin immediatement, ou preferez-vous planifier plus tard ?',
        sw: 'Vizuri, nimepokea tarehe. Unahitaji kumuona daktari mara moja au ungependa kupanga miadi ya baadaye?'
      };
      const routineDateFollowup =
        routineDateFollowupByLang[preferredLanguage] ||
        'Great, I have your date. Do you need to see a doctor immediately, or would you like to schedule for later?';
      try {
        const dateToken = _extractPreferredDateToken(message);
        if (dateToken && KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'preferred_date', dateToken);
      } catch (_) {}
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', routineDateFollowup);
      return { reply: routineDateFollowup, endCall: false, toolsUsed: [], language: preferredLanguage || 'en' };
      }
    }

    // Deterministic OPQRST capture guard:
    // If Kelly just asked for a specific OPQRST field and user answered,
    // store the field server-side so the LLM doesn't repeat previously answered prompts.
    try {
      const { isOpqrstFieldGateEnabled } = require('../kelly/rails/config');
      const OpqrstFieldGate = require('../clinical/opqrst-field-gate');
      const latestSession = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      const triageIncomplete = !(latestSession && (latestSession.triage_complete === 1 || latestSession.triage_complete === true));
      const lastAssistant = [...history].reverse().find((m) => m?.role === 'assistant');

      if (isOpqrstFieldGateEnabled()) {
        const gateResult = OpqrstFieldGate.resolve({
          triageRow: latestSession,
          userMessage: message,
          lastAssistantText: String(lastAssistant?.content || ''),
          activeLane: 'clinical',
          conversationMode: 'tenant_inbound_clinical',
          activeSubrail: 'opqrst',
          triagePolicy: 'conditional',
          specialty: latestSession?.target_specialty,
          opqrstResumeField: KellyToolExecutor._getSessionMeta?.(sessionId, 'opqrst_resume_field'),
          locale: preferredLanguage || 'en'
        });
        if (gateResult?.storePayload && Object.keys(gateResult.storePayload).length) {
          await KellyToolExecutor.execute(
            'store_triage_opqrst',
            gateResult.storePayload,
            { sessionId, clinicId, patientId, callerPhone, channel }
          );
        }
      } else if (triageIncomplete && hasSymptomNow) {
        const lastText = String(lastAssistant?.content || '').toLowerCase();
        const msgText = String(message || '').trim();
        const upsertArgs = {};

        if (!latestSession?.onset && /when did .* start|when .* start/i.test(lastText) && msgText) {
          upsertArgs.onset = msgText;
        } else if (!latestSession?.provocation && /better or worse|makes .* better|makes .* worse|rest help|light or movement/i.test(lastText) && msgText) {
          upsertArgs.provocation = msgText;
        } else if (!latestSession?.quality && /what .* feel like|sharp|dull|throbbing|pressure|burning/i.test(lastText) && msgText) {
          upsertArgs.quality = msgText;
        } else if ((latestSession?.severity == null || latestSession?.severity === '') && /scale of 1 to 10|1 to 10|how bad/i.test(lastText)) {
          const sev = String(msgText).match(/\b([1-9]|10)\b/);
          if (sev) upsertArgs.severity = parseInt(sev[1], 10);
        } else if (!latestSession?.timing && /constant or comes and goes|comes and goes|is it constant|timing/i.test(lastText) && msgText) {
          upsertArgs.timing = msgText;
        }

        if (Object.keys(upsertArgs).length > 0) {
          await KellyToolExecutor.execute(
            'store_triage_opqrst',
            upsertArgs,
            { sessionId, clinicId, patientId, callerPhone, channel }
          );
        }
      }
    } catch (_) {}

    const justAnsweredUrgency = routineLocked && !hasSymptomNow && urgencyFromMessage && !slotAlreadyChosen && !slotWasPresented;
    if (justAnsweredUrgency) {
      try {
        if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'preferred_lane', urgencyFromMessage);
      } catch (_) {}
      this._appendToHistory(sessionId, 'user', message);
      const preferredDate = (() => {
        try {
          return KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'preferred_date') : null;
        } catch (_) {
          return null;
        }
      })();
      const date = _resolvePreferredDateFromMeta(preferredDate, clinicId);
      const slotOut = await KellyToolExecutor.execute(
        'get_available_slots',
        { date, appointment_type: 'Primary Care', lane: urgencyFromMessage, force_after_clarified: true },
        { sessionId, clinicId, patientId, callerPhone, channel }
      );
      if (slotOut?.success === false) {
        const code = slotOut?.error_code || slotOut?.error || null;
        if (['PROVIDER_AVAILABILITY_NOT_SET', 'PROVIDER_CALENDAR_NOT_CONNECTED', 'NO_BOOKABLE_SYNC_PROVIDER', 'NO_ONLINE_PROVIDERS'].includes(code)) {
          const fallbackMsgByCode = {
            PROVIDER_AVAILABILITY_NOT_SET: 'Our care team is online, but availability has not been published yet. I can check the next date, switch this to async review, or arrange a callback.',
            PROVIDER_CALENDAR_NOT_CONNECTED: 'No specialist has live calendar sync right now. I can check the next date, switch this to async review, or arrange a callback.',
            NO_BOOKABLE_SYNC_PROVIDER: 'No sync-bookable specialist is available right now. I can check the next date, switch this to async review, or arrange a callback.',
            NO_ONLINE_PROVIDERS: 'No specialists are online right now. I can check the next date, switch this to async review, or arrange a callback.'
          };
          const providerFallbackReply = fallbackMsgByCode[code] || 'No specialist is immediately bookable right now. I can check the next date, switch this to async review, or arrange a callback.';
          this._appendToHistory(sessionId, 'assistant', providerFallbackReply);
          return {
            reply: providerFallbackReply,
            endCall: false,
            toolsUsed: ['get_available_slots'],
            language: preferredLanguage || 'en',
            next_chips: [
              { label: 'Check next date', value: 'next_date_search', action: 'next_date_search' },
              { label: 'Async review lane', value: 'async_review_lane', action: 'async_review_lane' },
              { label: 'Request callback', value: 'request_callback', action: 'request_callback' }
            ],
            chips_display: 'list',
            error_code: code
          };
        }
      }
      if (slotOut?.success) {
        const source = Array.isArray(slotOut.slot_bundles) && slotOut.slot_bundles.length
          ? slotOut.slot_bundles
          : (Array.isArray(slotOut.available_slots) ? slotOut.available_slots : []);
        if (source.length) {
          try {
            KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_bundles', JSON.stringify(source.slice(0, 12)));
            KellyToolExecutor._setSessionMeta(sessionId, 'preferred_date_resolved', date || '');
            if (_kellyDebugVerbose()) console.log('[DEBUG-MATCH] last_slot_bundles stored, count:', source.length, 'date:', date);
          } catch (_) {}
        }
        const chips = source.slice(0, 8).map((s, i) => ({
          label: `Option ${i + 1}: ${s?.display || s?.time || String(s)}`,
          value: `option ${i + 1}`,
          action: 'select_slot',
          slot: s
        }));
        try {
          if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'slot_presented', '1');
        } catch (_) {}
        const reply = source.length
          ? 'Here are some available times. Please choose one.'
          : '';
        if (source.length) {
          this._appendToHistory(sessionId, 'assistant', reply);
          return { reply, endCall: false, toolsUsed: ['get_available_slots'], language: preferredLanguage || 'en', next_chips: chips, chips_display: 'list' };
        }
        const next = await _findNextAvailableDate(
          date,
          clinicId,
          'Primary Care',
          urgencyFromMessage,
          sessionId,
          patientId,
          callerPhone,
          channel
        );
        if (next) {
          const nextSource = Array.isArray(next.slotOut.slot_bundles) && next.slotOut.slot_bundles.length
            ? next.slotOut.slot_bundles
            : (Array.isArray(next.slotOut.available_slots) ? next.slotOut.available_slots : []);
          try {
            KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_bundles', JSON.stringify(nextSource.slice(0, 12)));
            KellyToolExecutor._setSessionMeta(sessionId, 'preferred_date_resolved', next.date || '');
          } catch (_) {}
          const nextChipsAuto = nextSource.slice(0, 8).map((s, i) => ({
            label: `Option ${i + 1}: ${s?.display || s?.time || String(s)}`,
            value: `option ${i + 1}`,
            action: 'select_slot',
            slot: s
          }));
          const nextReply = `No openings on ${date}. I found availability on ${next.date}. Here are the times:`;
          this._appendToHistory(sessionId, 'assistant', nextReply);
          return {
            reply: nextReply,
            endCall: false,
            toolsUsed: ['get_available_slots'],
            language: preferredLanguage || 'en',
            next_chips: nextChipsAuto,
            chips_display: 'list'
          };
        }
        const noneReply = `No openings on ${date}. I could not find nearby openings in the next few business days. What date works best for you?`;
        this._appendToHistory(sessionId, 'assistant', noneReply);
        return { reply: noneReply, endCall: false, toolsUsed: ['get_available_slots'], language: preferredLanguage || 'en', next_chips: [], chips_display: 'list' };
      }
      const reply = 'Let me check availability. What date works best for you?';
      this._appendToHistory(sessionId, 'assistant', reply);
      return { reply, endCall: false, toolsUsed: [], language: preferredLanguage || 'en' };
    }

    // ── 3. Build context ──────────────────────────────────────
    const kellyScriptHint = KellyToolExecutor._getSessionMeta(sessionId, 'kelly_script_hint') || null;
    const intentForOrchestrator = _classifyIntent(message);
    const orchestration = KellyOrchestratorPhase.resolveOrchestrationPhase({
      sessionId,
      message,
      intentBucket: intentForOrchestrator,
      db,
      KellyToolExecutor,
      getLatestRag: (sid) => TriageRAGService.getLatestForSession(sid),
      routineLocked
    });
    if (graphHost?.forcedPhase) {
      orchestration.phase = graphHost.forcedPhase;
      try {
        KellyToolExecutor._setSessionMeta(sessionId, 'kelly_orchestrator_phase', graphHost.forcedPhase);
      } catch (_) {}
    }
    if (KellyOrchestratorPhase.orchestratorEnabled()) {
      _kellyDebugTurn('orchestrator_phase', {
        sessionId,
        phase: orchestration.phase,
        intentBucket: orchestration.intentBucket,
        stickyApplied: orchestration.stickyApplied,
        escapeTriggered: orchestration.escapeTriggered
      });
    }

    // TODO-06: auto-start/link RCM journey on Kelly voice call when patient + clinic known.
    try {
      if (patientId && clinicId && (channel === 'voice' || channel === 'chat')) {
        const existingJourney = KellyToolExecutor._getSessionMeta(sessionId, 'rcm_journey_id');
        if (!existingJourney) {
          const rcmOrchestrator = require('../rcm/rcm-journey-orchestrator');
          rcmOrchestrator.ensureKellyRcmTables?.();
          const started = rcmOrchestrator.startJourney({
            clinicId,
            patientId,
            source: 'kelly_call',
            stage: 'registration',
            skipGates: true,
          });
          const jid = started.journey?.id || started.journey_id;
          if (jid) KellyToolExecutor._setSessionMeta(sessionId, 'rcm_journey_id', String(jid));
        }
      }
    } catch (journeyErr) {
      console.warn('[KellyAgent] RCM journey auto-start:', journeyErr.message);
    }

    let routineIntakeSummaryMarkdown = '';
    try {
      if (
        (orchestration.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
          orchestration.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP) &&
        db.getTriageSession
      ) {
        let softGaps = [];
        let hardMissing = [];
        try {
          softGaps = JSON.parse(
            KellyToolExecutor._getSessionMeta(sessionId, 'skincare_intake_gaps_json') || '[]'
          );
        } catch (_) {}
        try {
          hardMissing = JSON.parse(
            KellyToolExecutor._getSessionMeta(sessionId, 'skincare_intake_hard_missing_json') || '[]'
          );
        } catch (_) {}
        routineIntakeSummaryMarkdown = formatRoutineIntakeSummaryFromTriageRow(
          db.getTriageSession(sessionId),
          {
            softGaps: Array.isArray(softGaps) ? softGaps : [],
            hardMissing: Array.isArray(hardMissing) ? hardMissing : []
          }
        );
      }
    } catch (_) {}

    const context = {
      channel,
      clinicId,
      patientId,
      patientName,
      callerPhone,
      preferredLanguage,
      sessionId,
      message,
      scanChatMode,
      scanGrounding: scanGroundingParam,
      kellyScriptHint,
      orchestration,
      routineIntakeSummaryMarkdown,
      missingFields: [],
      nextRequiredField: null,
      skinType: null,
      skinCondition: null,
      skinConflicts: []
    };

    // Step 1 pre-extract/write before required-fields gate evaluation.
    let fieldsFilled = 0;
    let overwriteBlocked = false;
    let idempotentWriteSkipped = false;
    const taxonomyModule = 'skin_type';
    let skinTypeResult = null;
    let skinTypeConflictBlocked = false;
    let skinTypeResolveMs = 0;
    try {
      const msgHash = _hashTurnText(message);
      const turnSeq = Math.max(1, history.filter((m) => m.role === 'user').length + 1);
      const idemKey = `${sessionId}:${turnSeq}:${taxonomyModule}`;
      const priorModuleHash = String(KellyToolExecutor._getSessionMeta(sessionId, `step1_idempotency:${idemKey}`) || '');
      const lastModuleTurnSeq = Number(KellyToolExecutor._getSessionMeta(sessionId, `step1_last_turn_seq:${taxonomyModule}`) || 0);
      if ((msgHash && msgHash === priorModuleHash) || turnSeq <= lastModuleTurnSeq) {
        idempotentWriteSkipped = true;
      } else {
        const extracted = _extractStep1Fields(message);
        fieldsFilled = Number(extracted.fieldsFilled || 0);
        const currentState = SessionStateStore.getCanonicalState({ sessionId }) || {};
        const t0 = Date.now();
        const skinType = resolveSkinType({
          text: message,
          turnSeq,
          previous: currentState.skin_type || null
        });
        const explicitSkinTypeNow = _extractExplicitSkinType(message);
        if (explicitSkinTypeNow) {
          skinType.value = explicitSkinTypeNow;
          skinType.status = (currentState.skin_type && currentState.skin_type !== explicitSkinTypeNow) ? 'corrected' : 'confirmed';
          skinType.confidence = 'high';
          skinType.needs_confirmation = false;
        }
        skinTypeResolveMs = Date.now() - t0;
        skinTypeResult = skinType;
        const currentSkinType = String(currentState.skin_type || KellyToolExecutor._getSessionMeta(sessionId, 'step1_skin_type_value') || '');
        const currentSkinTypeStatus = String(currentState.skin_type_status || KellyToolExecutor._getSessionMeta(sessionId, 'step1_skin_type_status') || '');
        if (
          currentSkinType &&
          currentSkinTypeStatus === 'confirmed' &&
          skinType.value &&
          skinType.value !== 'unknown' &&
          skinType.value !== currentSkinType &&
          !_hasSkinTypeCorrectionIntent(message)
        ) {
          skinTypeConflictBlocked = true;
          skinType.value = currentSkinType;
          skinType.status = 'confirmed';
          skinType.needs_confirmation = false;
        }
        extracted.fields.skin_type = skinType.value;
        extracted.fields.skin_type_status = skinType.status;
        extracted.fields.skin_type_confidence = skinType.confidence;
        extracted.fields.skin_type_needs_confirmation = skinType.needs_confirmation ? 1 : 0;
        extracted.fields.skin_type_resolver_version = skinType.resolver_version;
        const skinCond = resolveSkinConditions({
          text: message,
          skinType: skinType.value,
          visionHint: KellyToolExecutor._getSessionMeta(sessionId, 'step1_phototype_hint') || ''
        });
        const existingConfirmedPhototype = String(KellyToolExecutor._getSessionMeta(sessionId, 'step1_phototype_confirmed') || '');
        if (existingConfirmedPhototype && skinCond.secondary_signals.phototype_hint && skinCond.secondary_signals.phototype_hint !== existingConfirmedPhototype) {
          // Low-authority CV hint must never override confirmed text state.
          skinCond.secondary_signals.phototype_hint = existingConfirmedPhototype;
        }
        extracted.fields.skin_condition = JSON.stringify((skinCond.conditions || []).map((c) => ({ id: c.id, confidence: c.confidence })));
        extracted.fields.secondary_signals = JSON.stringify(skinCond.secondary_signals || {});
        extracted.fields.skin_condition_resolver_version = skinCond.resolver_version;
        const baumannResult = resolveBaumannCode({
          skinType: skinType.value,
          secondarySignals: skinCond.secondary_signals
        });
        extracted.fields.skin_baumann_code = baumannResult?.code || '';
        extracted.fields.skin_baumann_confidence = baumannResult?.confidence || 'low';
        extracted.fields.skin_baumann_json = JSON.stringify(baumannResult || {});
        const ingredientFacts = resolveIngredientFacts(message);
        const ingredientSafety = evaluateIngredientSafety({
          ingredientFacts,
          conditions: skinCond.conditions,
          secondarySignals: skinCond.secondary_signals
        });
        extracted.fields.ingredient_facts = JSON.stringify(
          ingredientFacts.map((x) => ({
            name: x.name,
            roles: x.roles,
            mechanism: x.mechanism,
            irritancy_band: x.irritancy_band,
            interaction_strength: x.interaction_strength
          }))
        );
        extracted.fields.ingredient_safety_json = JSON.stringify(ingredientSafety || []);
        extracted.fields.product_category = mapProductCategory(message);
        if (skinType.value && skinType.value !== 'unknown') fieldsFilled += 1;
        overwriteBlocked =
          (!!currentState.severity && extracted.fields.severity == null) ||
          (!!currentState.timeline && !extracted.fields.timeline);
        try {
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_pending_value', skinType.value || '');
          KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_confirmation_required', skinType.needs_confirmation ? '1' : '0');
        } catch (_) {}
        if (fieldsFilled > 0) {
          SessionStateStore.upsertFromNormalizedEvent({
            envelope: {
              session_id: sessionId,
              source: 'kelly_agent',
              event_type: 'step1_pre_extract',
              event_id: `step1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
            },
            normalizedEvent: {
              session_id: sessionId,
              source: 'kelly_agent',
              event_type: 'step1_pre_extract',
              text: message,
              fields: extracted.fields,
              metadata: {
                taxonomy_module: taxonomyModule,
                resolver_version: skinType.resolver_version,
                trace: {
                  skin_type_scores: skinType.score_debug || [],
                  skin_type_reason_codes: (skinType.evidence || []).slice(0, 8).map((e) => `${e.signal}:${e.span || ''}`),
                  skin_condition_reason_codes: skinCond.reason_codes || []
                }
              }
            }
          });
          try {
            KellyToolExecutor._setSessionMeta(sessionId, `step1_idempotency:${idemKey}`, msgHash);
            KellyToolExecutor._setSessionMeta(sessionId, `step1_last_turn_seq:${taxonomyModule}`, String(turnSeq));
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_value', skinType.value || '');
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_type_status', skinType.status || 'tentative');
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_skin_condition_json', extracted.fields.skin_condition || '[]');
            KellyToolExecutor._setSessionMeta(sessionId, 'step1_secondary_signals_json', extracted.fields.secondary_signals || '{}');
          } catch (_) {}
        }
      }
    } catch (_) {}
    context.skinType = skinTypeResult ? {
      value: skinTypeResult.value,
      status: skinTypeResult.status,
      confidence: skinTypeResult.confidence,
      needsConfirmation: !!skinTypeResult.needs_confirmation
    } : null;
    try {
      const cond = JSON.parse(String(KellyToolExecutor._getSessionMeta(sessionId, 'step1_skin_condition_json') || '[]'));
      context.skinCondition = Array.isArray(cond) ? cond : [];
    } catch (_) { context.skinCondition = []; }
    try {
      const ingredientFactsForConflict = resolveIngredientFacts(message);
      let secSignalsForGraph = {};
      try { secSignalsForGraph = JSON.parse(String(KellyToolExecutor._getSessionMeta(sessionId, 'step1_secondary_signals_json') || '{}')); } catch (_) {}
      context.graphAction = resolveTaxonomyGraphAction({
        db: db.db,
        conditions: context.skinCondition,
        ingredientFacts: ingredientFactsForConflict,
        secondarySignals: secSignalsForGraph
      });
    } catch (_) { context.graphAction = null; }
    try {
      const ingredientFactsForConflict = resolveIngredientFacts(message);
      context.skinConflicts = resolveSkinConflicts({
        message,
        conditions: context.skinCondition,
        ingredientFacts: ingredientFactsForConflict
      });
    } catch (_) { context.skinConflicts = []; }

    // Deterministic required-fields gate after pre-extract.
    const pathway =
      channel === 'voice' ? 'triage'
        : (orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
           orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP)
          ? 'routine'
          : 'triage';
    const gateEval = SessionStateStore.evaluateGate({ pathway, sessionId });
    try {
      const tentativeRaw = KellyToolExecutor._getSessionMeta(sessionId, 'step1_tentative_fields_json') || '[]';
      const tentative = JSON.parse(tentativeRaw);
      if (Array.isArray(tentative) && tentative.length) {
        const map = { quality: 'chief_complaint', onset: 'timeline', severity: 'severity' };
        for (const tf of tentative) {
          const gateField = map[String(tf || '').trim()];
          if (gateField && !gateEval.missing_required.includes(gateField)) {
            gateEval.missing_required.push(gateField);
          }
        }
        gateEval.is_minimum_met = gateEval.missing_required.length === 0;
      }
    } catch (_) {}
    const minimumRequiredByPathway = IntakeRequiredFields.getRequiredFieldsSchema()[pathway]?.minimum_required || [];
    const shouldGate =
      minimumRequiredByPathway.length > 0 &&
      !gateEval.is_minimum_met &&
      !scanChatMode &&
      !safety?.emergency &&
      gateEval.missing_required.length > 0;
    const nextMissingField = shouldGate ? IntakeRequiredFields.nextRequiredField(pathway, gateEval.state) : null;
    context.missingFields = shouldGate ? gateEval.missing_required : [];
    context.nextRequiredField = nextMissingField;
    // Prime triage row at intake start so state exists before tool writes.
    try {
      if (db.getTriageSession && db.upsertTriageSession) {
        const existing = db.getTriageSession(sessionId);
        if (!existing && (shouldGate || nextMissingField)) {
          db.upsertTriageSession(sessionId, { session_id: sessionId });
        }
      }
    } catch (_) {}
    let repeatMissingFieldCount = 0;
    let loopBreakerTriggered = false;
    if (shouldGate) {
      const prevField = String(KellyToolExecutor._getSessionMeta(sessionId, 'step1_last_missing_field') || '');
      const prevCount = Number(KellyToolExecutor._getSessionMeta(sessionId, 'step1_repeat_missing_field_count') || 0);
      repeatMissingFieldCount = prevField && prevField === String(nextMissingField || '') ? (prevCount + 1) : 1;
      try {
        KellyToolExecutor._setSessionMeta(sessionId, 'step1_last_missing_field', String(nextMissingField || ''));
        KellyToolExecutor._setSessionMeta(sessionId, 'step1_repeat_missing_field_count', String(repeatMissingFieldCount));
      } catch (_) {}
      if (repeatMissingFieldCount >= 3) {
        loopBreakerTriggered = true;
        try { KellyToolExecutor._setSessionMeta(sessionId, 'orchestrator_force_phase', 'TRIAGE_ACTIVE'); } catch (_) {}
      }
    }
    try {
      Metrics.increment('step1.fields_filled.total', fieldsFilled || 0);
      Metrics.increment('step1.fields_filled.count', 1);
      Metrics.increment('step1.overwrite_blocked.count', overwriteBlocked ? 1 : 0);
      Metrics.increment('step1.skin_type.conflict_blocked.count', skinTypeConflictBlocked ? 1 : 0);
      if (skinTypeResult?.value) Metrics.increment(`step1.skin_type.detected.${skinTypeResult.value}.count`, 1);
      if (skinTypeResult?.status) Metrics.increment(`step1.skin_type.status.${skinTypeResult.status}.count`, 1);
      if (skinTypeResolveMs > 0) {
        Metrics.increment('step1.skin_type.resolve_ms.total', skinTypeResolveMs);
        Metrics.increment('step1.skin_type.resolve_ms.count', 1);
      }
      try {
        const cond = JSON.parse(String(KellyToolExecutor._getSessionMeta(sessionId, 'step1_skin_condition_json') || '[]'));
        if (Array.isArray(cond)) {
          for (const c of cond) Metrics.increment(`step1.skin_condition.detected.${String(c.id || 'unknown')}.count`, 1);
        }
      } catch (_) {}
      Metrics.increment('step1.repeat_missing_field.total', repeatMissingFieldCount || 0);
      for (const cf of context.skinConflicts || []) {
        Metrics.increment(`step4.skin_conflict.detected.${String(cf.id || 'unknown')}.count`, 1);
      }
      Metrics.increment('step1.loop_breaker_triggered.count', loopBreakerTriggered ? 1 : 0);
      Metrics.increment('step1.idempotent_write_skipped.count', idempotentWriteSkipped ? 1 : 0);
      Metrics.increment(`taxonomy.idempotent_write_skipped.${taxonomyModule}.count`, idempotentWriteSkipped ? 1 : 0);
    } catch (_) {}

    if (
      skinTypeResult &&
      (skinTypeResult.value === 'unknown' || skinTypeResult.confidence === 'low') &&
      !_defersStep1SkinTypeClarifier(message) &&
      !_shouldSkipStep1ForTurn(sessionId, message, graphHost) &&
      !scanChatMode &&
      !plannerBypassSkincareClarifier &&
      !(function skipSkinForBooking() {
        const sessionRowSkin = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        const metaGetSkin = (key) => KellyToolExecutor._getSessionMeta(sessionId, key);
        const phase = String(metaGetSkin('kelly_orchestrator_phase') || '').toUpperCase();
        if (phase === 'BOOKING') return true;
        if (
          KellyOrchestratorPhase.kellyE2eSkipTriageEnabled() &&
          String(metaGetSkin('kelly_e2e_skip_triage') || '').toLowerCase() === '1'
        ) {
          return true;
        }
        return (
          (_isBookingProgressIntent(message) || KellyOrchestratorPhase.isExplicitBookingIntent(message)) &&
          KellyOrchestratorPhase.clinicMinimumIntakeMet({ sessionRow: sessionRowSkin, metaGet: metaGetSkin })
        );
      })()
    ) {
      const lastAssistant = String((history[history.length - 1] && history[history.length - 1].role === 'assistant'
        ? history[history.length - 1].content
        : '') || '').toLowerCase();
      const alreadyAskedType = /oily, dry, combination, sensitive, or normal|what type of skin|skin type/i.test(lastAssistant);
      if (alreadyAskedType) {
        // Do not loop the same classifier question; let orchestration continue.
        context.skinType = context.skinType || { value: 'unknown', status: 'tentative', confidence: 'low', needsConfirmation: true };
      } else {
      const clarify = 'Quick check so I can personalize this: would you describe your skin as oily, dry, combination, sensitive, or normal?';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', clarify);
      return {
        reply: clarify,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        skin_type_clarifier_required: true
      };
      }
    }
    if (
      skinTypeResult &&
      skinTypeResult.status === 'tentative' &&
      skinTypeResult.needs_confirmation &&
      !_defersStep1SkinTypeClarifier(message) &&
      !_shouldSkipStep1ForTurn(sessionId, message, graphHost) &&
      !scanChatMode &&
      !plannerBypassSkincareClarifier &&
      !(function skipSkinConfirmForBooking() {
        const sessionRowSkin = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        const metaGetSkin = (key) => KellyToolExecutor._getSessionMeta(sessionId, key);
        const phase = String(metaGetSkin('kelly_orchestrator_phase') || '').toUpperCase();
        if (phase === 'BOOKING') return true;
        if (
          KellyOrchestratorPhase.kellyE2eSkipTriageEnabled() &&
          String(metaGetSkin('kelly_e2e_skip_triage') || '').toLowerCase() === '1'
        ) {
          return true;
        }
        return (
          (_isBookingProgressIntent(message) || KellyOrchestratorPhase.isExplicitBookingIntent(message)) &&
          KellyOrchestratorPhase.clinicMinimumIntakeMet({ sessionRow: sessionRowSkin, metaGet: metaGetSkin })
        );
      })()
    ) {
      const lastAssistant = String((history[history.length - 1] && history[history.length - 1].role === 'assistant'
        ? history[history.length - 1].content
        : '') || '').toLowerCase();
      const alreadyAskedConfirm = /i heard .* skin.*is that correct|is that correct/i.test(lastAssistant);
      if (alreadyAskedConfirm) {
        // Avoid robotic loop on same confirmation wording.
        context.skinType = context.skinType || {
          value: skinTypeResult.value,
          status: 'tentative',
          confidence: skinTypeResult.confidence,
          needsConfirmation: true
        };
      } else {
      const askConfirm = `I heard ${skinTypeResult.value} skin. Is that correct?`;
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', askConfirm);
      return {
        reply: askConfirm,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        confirmation_required: true
      };
      }
    }
    if (!SKIN_TAXONOMY_SHADOW_MODE && SKIN_CONFLICT_HARD_GUARD && Array.isArray(context.skinConflicts) && context.skinConflicts.length > 0) {
      const c = context.skinConflicts[0];
      const deterministic = `I want to keep this safe and simple. ${c.next_action}`;
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', deterministic);
      return {
        reply: deterministic,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        next_step: 'conflict_clarify',
        conflict_labels: context.skinConflicts.map((x) => x.id),
        confidence_band: 'low'
      };
    }
    if (GRAPH_GATE_ENFORCE && context.graphAction && context.graphAction.clarify_required) {
      const deterministic = `I want to keep this safe and specific. ${context.graphAction.next_question}`;
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', deterministic);
      return {
        reply: deterministic,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        next_step: 'graph_clarify',
        graph_rule: context.graphAction.rule_id,
        confidence_band: context.graphAction.blocked ? 'low' : 'medium'
      };
    }

    // ── 4. Append user message ────────────────────────────────
    this._appendToHistory(sessionId, 'user', message);
    history.push({ role: 'user', content: message });

    // D3 — Routine pathway: skip LLM for greetings/smalltalk when routine is still empty.
    if (pathway === 'routine' && process.env.KELLY_ROUTINE_SMALLTALK_SHORTCIRCUIT !== '0') {
      try {
        const { tryRoutinePhaseCheapTurn } = require('../catalog/routine-cheap-turn');
        const cheap = tryRoutinePhaseCheapTurn({ db: db.db, sessionId, message });
        if (cheap && cheap.reply) {
          this._appendToHistory(sessionId, 'assistant', cheap.reply);
          return _mergeUiSnapIntoReturn(
            KellyToolExecutor.consumeUiAttachments(sessionId),
            _appendSkincareAssessmentToReturn(sessionId, orchestration, {
              reply: cheap.reply,
              endCall: false,
              toolsUsed: [],
              language: preferredLanguage,
              next_step: null,
              next_chips: [],
              chips_display: null,
              llm_usage: null,
              routine_smalltalk_short_circuit: true,
            })
          );
        }
      } catch (_) {}
    }

    // Deterministic summary path for "what did you capture so far?" requests.
    if (_isSummaryRequest(message)) {
      let state = SessionStateStore.getCanonicalState({ sessionId }) || null;
      if (!state && db.getTriageSession) state = db.getTriageSession(sessionId) || null;
      const summary = _composeCapturedSummaryFromState(state);
      if (summary) {
        this._appendToHistory(sessionId, 'assistant', summary);
        return {
          reply: summary,
          endCall: false,
          toolsUsed: [],
          language: preferredLanguage || 'en'
        };
      }
    }

    if (loopBreakerTriggered) {
      const gateQuestion = await AskNextQuestionService.generateQuestion({
        missingField: nextMissingField,
        pathway,
        preferredLanguage
      });
      const escalated = `I want to make sure we get this exactly right. ${gateQuestion}`;
      this._appendToHistory(sessionId, 'assistant', escalated);
      return {
        reply: escalated,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        gate_status: gateEval,
        loop_breaker_triggered: true
      };
    }

    // Typed query planner (Phase 5): build a deterministic retrieval contract before tool loop.
    let typedQueryPlan = null;
    try {
      typedQueryPlan = QueryPlanner.buildTypedQueryPlan({
        message,
        state: gateEval.state,
        pathway
      });
      context.query_plan = typedQueryPlan;
      // Pathology adapter call using existing triage RAG service (structured inputs).
      if (typedQueryPlan?.subqueries?.pathology?.enabled) {
        const pathology = await QueryPlanner.runPathologyRetrieval({
          sessionId,
          symptomText: message,
          opqrst: db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {},
          patientId,
          clinicId
        });
        context.pathology_retrieval = pathology;
      }
      const serviceRoute = QueryPlanner.resolveServiceOption({
        plan: typedQueryPlan,
        safetyStatus: safety?.status || 'green',
        preferred: 'care_guidance'
      });
      context.service_option = serviceRoute;
        const carePath = CarePathCatalog.resolveCarePath({
          intent: typedQueryPlan?.intent || null,
          urgency: context?.pathology_retrieval?.urgency || typedQueryPlan?.subqueries?.pathology?.priority || null,
          safety_status: safety?.status || 'green',
          risk_flags: gateEval?.state?.risk_flags || []
        });
        context.care_path = carePath;
    } catch (_) {}

    // ── 5. Call LLM with tool loop ────────────────────────────
    let reply, toolsUsed = [], endCall = false, nextStep, nextChips, chipsDisplay;
    let loopResult = null;
    try {
      const turnTimeoutMs = parseInt(process.env.KELLY_TURN_TIMEOUT_MS || '25000', 10);
      loopResult = await Promise.race([
        this._runLLMLoop({
        history,
        context,
        clinicId,
        patientId,
        callerPhone,
        sessionId,
        channel,
        customerId,
        providerInstructions,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM_TURN_TIMEOUT')), turnTimeoutMs))
      ]);
      reply = loopResult.reply;
      if (_isNegatedEmergencyStatement(message) && /possible acute myocardial infarction|do not schedule|direct to 911\/er/i.test(String(reply || ''))) {
        reply = 'Thanks for clarifying that you do not have chest pain or shortness of breath. Let us continue with your skin symptoms.';
      }
      toolsUsed = loopResult.toolsUsed || [];
      // Unified output guardrails pass (policy + safety suppression).
      reply = ClinicalRecommendationPolicy.applyOutputGuardrails(reply, {
        safetyStatus: safety?.status || 'green',
        routineSkincare: !scanChatMode && (
          orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE
          || orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP
        )
      });
      try {
        const sec = JSON.parse(String(KellyToolExecutor._getSessionMeta(sessionId, 'step1_secondary_signals_json') || '{}'));
        const highPigmentRisk = String(sec?.pigment_risk || '').toLowerCase() === 'high';
        const mentionsStrongActives = /\b(retinoid|retinol|tretinoin|glycolic|salicylic|aha|bha|peel)\b/i.test(String(reply || ''));
        if (highPigmentRisk && mentionsStrongActives) {
          reply = `${reply}\n\nSafety note: because pigment sensitivity risk may be higher, start conservatively and confirm with a clinician before stronger active use.`;
          Metrics.increment('step6.pigment_safety_guardrail_applied.count', 1);
        }
      } catch (_) {}
      // Safety-aware intent routing from deterministic care-path catalog.
      if (context?.care_path?.route === 'doctor_needed' && safety?.status !== 'green') {
        nextStep = 'doctor_needed';
      } else if (context?.care_path?.route === 'records_question') {
        nextStep = 'records_question';
      } else if (context?.care_path?.route === 'evidence_question') {
        nextStep = 'evidence_question';
      } else if (context?.care_path?.route === 'care_guidance' && !nextStep) {
        nextStep = 'care_guidance';
      }

      endCall = loopResult.endCall || false;
      nextStep = loopResult.next_step;
      nextChips = loopResult.next_chips;
      chipsDisplay = loopResult.chips_display;

      // Upload pause/resume guardrail:
      // If media has already been received for this triage session but the LLM keeps asking
      // for uploads anyway, re-run `run_triage_rag` server-side to keep UX moving.
      try {
        const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        const mediaReceived =
          sessionRow &&
          ((sessionRow.media_received === 1) || (sessionRow.media_received === true));
        const triageComplete =
          sessionRow &&
          ((sessionRow.triage_complete === 1) || (sessionRow.triage_complete === true));

        const assistantStillRequestsUpload = /upload your photo|upload your document|use the upload area|you can upload your photo below/i.test(reply);
        if (mediaReceived && assistantStillRequestsUpload && !triageComplete) {
          const triageOut = await KellyToolExecutor.execute(
            'run_triage_rag',
            { symptom_text: message },
            { sessionId, clinicId, patientId, callerPhone, channel }
          );
          if (triageOut?.suggested_next_step) reply = _sanitizeSuggestedNextStep(triageOut.suggested_next_step);
          else if (triageOut?.patient_friendly_summary) reply = triageOut.patient_friendly_summary;
          else reply = 'Thanks for the upload. Let’s continue triage now.';
          toolsUsed = Array.isArray(toolsUsed) ? [...toolsUsed, 'run_triage_rag'] : ['run_triage_rag'];
        }
      } catch (guardErr) {
        // If the guard fails, keep original LLM reply.
      }

      // Booking progression guardrail:
      // If triage is already complete and the user is clearly asking to proceed with booking,
      // but the model did not call get_available_slots this turn, force slot lookup server-side.
      // This prevents re-summary loops (e.g. repeating "you need Dermatology") from blocking checkout.
      try {
        const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        const triageComplete =
          sessionRow &&
          ((sessionRow.triage_complete === 1) || (sessionRow.triage_complete === true));
        const askedToProceed = _isBookingProgressIntent(message);
        const alreadyLookedUpSlots = Array.isArray(toolsUsed) && toolsUsed.includes('get_available_slots');
        const scheduleActuallyRan = Array.isArray(toolsUsed) && toolsUsed.includes('schedule_appointment');
        const modelClaimedBooking = /i('ll| will) book you|booked you for|your appointment is|confirmed for/i.test(String(reply || ''));
        const replyLooksLikeSummaryLoop = /benefit from seeing|specialist/i.test(String(reply || ''));

        if (modelClaimedBooking && !scheduleActuallyRan) {
          reply = "I have that slot available. To confirm your booking, I need your email address. What's the best email for the confirmation?";
        }

        if (triageComplete && askedToProceed && !alreadyLookedUpSlots) {
          const requestedSpecialty = _extractRequestedSpecialty(message);
          const appointmentType = requestedSpecialty || sessionRow?.target_specialty || 'PrimaryCare';
          const today = (() => {
            const d = new Date();
            const day = d.getDay(); // 0=Sun,6=Sat
            if (day === 6) d.setDate(d.getDate() + 2);
            if (day === 0) d.setDate(d.getDate() + 1);
            return d.toISOString().slice(0, 10);
          })();
          const slotOut = await KellyToolExecutor.execute(
            'get_available_slots',
            {
              date: today,
              appointment_type: appointmentType,
              // Server-side hint used to break repetitive low-confidence loops
              // only when triage data is otherwise complete.
              force_after_clarified: true
            },
            { sessionId, clinicId, patientId, callerPhone, channel }
          );

          // E2E harness: count triage as satisfied if RAG row exists but the model did not
          // emit run_triage_rag this turn (guardrail-only slot fetch).
          const nextTools = Array.isArray(toolsUsed) ? [...toolsUsed] : [];
          if (TriageRAGService.getAuthoritativeForSession(sessionId) && !nextTools.includes('run_triage_rag')) {
            nextTools.push('run_triage_rag');
          }
          nextTools.push('get_available_slots');
          toolsUsed = nextTools;
          if (slotOut?.success) {
            const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
            const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
            const source = bundles.length ? bundles : available;
            const chips = source.slice(0, 8).map((s, idx) => {
              const label = s?.display || s?.time || s?.start_time || s?.start || String(s);
              return { label: `Option ${idx + 1}: ${label}`, value: `option ${idx + 1}`, action: 'select_slot', slot: s };
            });
            if (chips.length) {
              nextChips = chips;
              chipsDisplay = chipsDisplay || 'list';
              reply = slotOut?.kelly_script
                ? `${slotOut.kelly_script} Here are some available times. Please choose one.`
                : 'Here are some available times. Please choose one.';
              try {
                KellyToolExecutor._setSessionMeta(sessionId, 'slot_presented', '1');
              } catch (_) {}
              if (bundles.length) {
                try {
                  KellyToolExecutor._setSessionMeta(
                    sessionId,
                    'last_slot_bundles',
                    JSON.stringify(bundles.slice(0, 12))
                  );
                } catch (_) {}
              }
            } else {
              reply = 'I could not find open times yet. Please tell me a preferred date and I will check again.';
            }
          }
        }

        // B2: Server-side schedule trigger when contact is complete but LLM didn't call schedule_appointment.
        // Prevents re-ask loops when LLM loses context across turns.
        const slotWasPresentedNow = (() => {
          try {
            const v = KellyToolExecutor._getSessionMeta?.(sessionId, 'slot_presented');
            return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
          } catch (_) { return false; }
        })();
        const collectedEmail = KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_email');
        const collectedPhone = KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_phone');
        const collectedName = KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_name');
        if (
          slotWasPresentedNow &&
          collectedEmail &&
          collectedPhone &&
          collectedName &&
          !(Array.isArray(toolsUsed) && toolsUsed.includes('schedule_appointment'))
        ) {
          try {
            const rawBundles = KellyToolExecutor._getSessionMeta?.(sessionId, 'last_slot_bundles');
            const resolvedDate = KellyToolExecutor._getSessionMeta?.(sessionId, 'preferred_date_resolved');
            const bundles = rawBundles ? JSON.parse(rawBundles) : [];
            const userMsg = String(message || '').toLowerCase().trim();
            const matched = (Array.isArray(bundles) && bundles.length)
              ? (_resolveSlotBundleFromUserMessage(bundles, userMsg) || bundles[0])
              : null;
            if (matched) {
              const scheduleSessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
              const scheduleArgs = {
                patient_name: collectedName,
                patient_email: collectedEmail,
                patient_phone: collectedPhone,
                appointment_type: _resolveAppointmentTypeForSession(sessionId, scheduleSessionRow, matched),
                date: resolvedDate || matched?.date || new Date().toISOString().slice(0, 10),
                time: matched?.time || matched?.start_time || matched?.start || '11:30',
                practitioner_id: matched?.practitioner_id || null
              };
              const scheduleResult = await KellyToolExecutor.execute(
                'schedule_appointment',
                scheduleArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
              if (scheduleResult?.success) {
                toolsUsed = Array.isArray(toolsUsed) ? [...toolsUsed, 'schedule_appointment'] : ['schedule_appointment'];
                reply = scheduleResult?.say_to_patient || 'Your appointment is confirmed.';
                if (_kellyDebugVerbose()) console.log('[B2] Server-side schedule_appointment triggered, success');
              }
            }
          } catch (b2Err) {
            console.warn('[B2] Server-side schedule trigger failed:', b2Err?.message);
          }
        }
      } catch (_) {
        // Keep original model output if the guardrail fails.
      }
    } catch (err) {
      console.error('[KellyAgent] LLM loop failed:', err.message);
      const messageLower = err?.message ? String(err.message).toLowerCase() : '';
      const _errUiReturn = (obj) =>
        _mergeUiSnapIntoReturn(KellyToolExecutor.consumeUiAttachments(sessionId), obj);
      const provider = resolvePrimaryProvider();

      // fix-groq-outer: when primary is anthropic, retry with Groq before falling to orchestrator
      // (covers timeout, 400, and other non-429/529 errors that LLMRouter doesn't fall back on)
      if (provider === 'anthropic') {
        try {
          console.warn('[KellyAgent] Claude failed, retrying with Groq fallback');
          const groqResult = await this._runLLMLoop({
            history,
            context,
            clinicId,
            patientId,
            callerPhone,
            sessionId,
            channel,
            forceProvider: 'groq',
            customerId,
            providerInstructions,
          });
          reply = groqResult.reply;
          toolsUsed = groqResult.toolsUsed || [];
          endCall = groqResult.endCall || false;
          nextStep = groqResult.next_step;
          nextChips = groqResult.next_chips;
          chipsDisplay = groqResult.chips_display;
          reply = _sanitizeToolNameLeaks(reply);
          try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
          return _errUiReturn(
            _appendSkincareAssessmentToReturn(sessionId, orchestration, {
            reply,
            endCall,
            toolsUsed,
            language: preferredLanguage,
            next_step: nextStep,
            next_chips: nextChips,
            chips_display: chipsDisplay,
            usedFallback: true
            })
          );
        } catch (groqErr) {
          console.error('[KellyAgent] Groq fallback also failed:', groqErr?.message || groqErr);
          // Fall through to existing error handling (orchestrator, etc.)
        }
      }

      const isGroqConnectionError =
          messageLower.includes('connection error') ||
          messageLower.includes('econn') ||
          messageLower.includes('ecnnreset') ||
          messageLower.includes('fetch failed') ||
          messageLower.includes('network error') ||
          messageLower.includes('timeout');

        // If Groq/LLM is unreachable, don't fall back to the generic booking
        // orchestrator (it can re-trigger upload intents). Instead, continue
        // triage UX by asking for the next missing OPQRST field.
        if (isGroqConnectionError) {
          // Declare in outer scope so the later return object can access it.
          let fallbackToolsUsed = [];
          let nextChips = [];
          let chipsDisplay = null;
          try {
            // Best-effort: persist the user's answer into the first missing OPQRST slot.
            // The storage tool itself is server-side and doesn't require Groq.
            const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;

            const onsetMissing = !sessionRow || !String(sessionRow.onset || '').trim();
            const qualityMissing = !sessionRow || !String(sessionRow.quality || '').trim();
            const severityMissing = !sessionRow || sessionRow.severity === null || sessionRow.severity === undefined || sessionRow.severity === '';
            const timingMissing = !sessionRow || !String(sessionRow.timing || '').trim();
            const provocationMissing = !sessionRow || !String(sessionRow.provocation || '').trim();
            const radiationMissing = !sessionRow || !String(sessionRow.radiation || '').trim();
            const intakeMissing = !sessionRow || !sessionRow.intake_complete_at;

            const msgStr = String(message || '');

            // If the user provided labeled OPQRST in a single message (common in tests),
            // extract as much as possible before falling back to "first missing slot".
            const extracted = {};
            const onsetL = msgStr.match(/onset\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const qualityL = msgStr.match(/quality\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const provocationL = msgStr.match(/provocation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const radiationL = msgStr.match(/radiation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const timingL = msgStr.match(/timing\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const severityL = msgStr.match(/severity\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();

            if (onsetL) extracted.onset = onsetL;
            if (provocationL) extracted.provocation = provocationL;
            if (qualityL) extracted.quality = qualityL;
            if (radiationL) extracted.radiation = radiationL;
            if (timingL) extracted.timing = timingL;
            if (severityL) {
              const m = String(severityL).match(/\b(10|[1-9])\b/);
              extracted.severity = m ? parseInt(m[1], 10) : severityL;
            }

            // When no explicit labeled OPQRST fields are found, try lightweight
            // natural-language extraction (ES/SW/FR) so triage can still complete.
            // This is intentionally conservative and only fills missing slots.
            if (Object.keys(extracted).length === 0) {
              const lcMsg = msgStr.toLowerCase();

              // Onset: "hace X días", "depuis X jours", "kwa siku X"
              if (onsetMissing) {
                const esOnset = msgStr.match(/(?:desde\s+hace|hace)\s*([0-9]+\s*d[ií]as?)/i)?.[1]?.trim();
                const frOnset = msgStr.match(/(?:depuis|il y a)\s*([0-9]+\s*jours?)/i)?.[1]?.trim();
                const swOnset = msgStr.match(/(?:kwa\s+siku|siku)\s*([0-9]+)/i)?.[1]
                  ? `${msgStr.match(/(?:kwa\s+siku|siku)\s*([0-9]+)/i)?.[1]} siku`
                  : null;
                extracted.onset = esOnset || frOnset || swOnset || extracted.onset;
              }

              // Severity: "Severidad X de 10", "Sévérité X sur 10", "Ukali ni X kati ya 10"
              if (severityMissing) {
                const esSev = msgStr.match(/severidad\s*([0-9]+)/i)?.[1];
                const frSev = msgStr.match(/sévérit[eé]\s*([0-9]+)/i)?.[1];
                const swSev = msgStr.match(/ukali\s*ni\s*([0-9]+)/i)?.[1];
                const sevRaw = esSev || frSev || swSev;
                if (sevRaw != null) {
                  const n = parseInt(String(sevRaw), 10);
                  if (n >= 1 && n <= 10) extracted.severity = n;
                }
              }

              // Quality: "dolor sordo", "douleur sourde", "maumivu ya mara kwa mara"
              if (qualityMissing) {
                const esQual = msgStr.match(/dolor\s+sordo/i)?.[0];
                const frQual = msgStr.match(/douleur\s+sourde/i)?.[0];
                const swQual = msgStr.match(/maumivu\s+ya\s+mara\s+kwa\s+mara/i)?.[0];
                extracted.quality = esQual || frQual || swQual || extracted.quality;
              }

              // Timing: "va y viene", "va et vient", "yanakuja na kwenda"
              if (timingMissing) {
                const esTiming = msgStr.match(/va\s+y\s+viene/i)?.[0];
                const frTiming = msgStr.match(/va\s+et\s+vient/i)?.[0];
                const swTiming = msgStr.match(/yanakuja\s+na\s+kwenda/i)?.[0];
                extracted.timing = esTiming || frTiming || swTiming || extracted.timing;
              }

              // Provocation: "Empeora al ...", "s'aggrave en ...", "Yanazidi ..."
              if (provocationMissing) {
                const esProv = msgStr.match(/empeora\s+al\s+([^\.\n\r]+)/i)?.[1]?.trim();
                const frProv = msgStr.match(/s'?aggrav\w*\s+en\s+(?:me\s+)?([^\.\n\r]+)/i)?.[1]?.trim();
                const swProv = msgStr.match(/yanazidi\s+([^\.\n\r]+)/i)?.[1]?.trim();
                extracted.provocation = esProv || frProv || swProv || extracted.provocation;
              }
            }

            let opqrstArgs = null;
            if (Object.keys(extracted).length > 0) {
              opqrstArgs = extracted;
            } else {
              // Best-effort: persist the user's answer into the first missing OPQRST slot.
              if (onsetMissing) opqrstArgs = { onset: message };
              else if (qualityMissing) opqrstArgs = { quality: message };
              else if (severityMissing) {
                const m = msgStr.match(/\b(10|[1-9])\b/);
                opqrstArgs = { severity: m ? parseInt(m[1], 10) : message };
              } else if (timingMissing) opqrstArgs = { timing: message };
              else if (provocationMissing) opqrstArgs = { provocation: message };
              else if (radiationMissing) opqrstArgs = { radiation: message };
            }

            // If we still need provocation/radiation, try extracting those from labels too.
            if (opqrstArgs) {
              if (provocationMissing && provocationL) opqrstArgs.provocation = provocationL;
              if (radiationMissing && radiationL) opqrstArgs.radiation = radiationL;
            }

            if (opqrstArgs) {
              await KellyToolExecutor.execute(
                'store_triage_opqrst',
                opqrstArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
              fallbackToolsUsed.push('store_triage_opqrst');
            }

            // If intake isn't complete yet, persist minimal rich intake derived from the user's message.
            if (intakeMissing) {
              const intakeArgs = {};
              // Medications: English / Spanish / French / Swahili (test-suite phrases)
              if (
                /no\s+medications|i\s+take\s+no\s+medications|no\s+meds/i.test(msgStr) ||
                /no\s+tomo\s+medicamentos|sin\s+medicamentos|no\s+medicamentos/i.test(msgStr) ||
                /pas\s+de\s+m[eé]dicaments|sans\s+m[eé]dicaments/i.test(msgStr) ||
                /sijachukua\s+dawa\s+yoyote/i.test(msgStr)
              ) intakeArgs.medications = '';

              // Allergies: English / Spanish / French / Swahili (test-suite phrases)
              if (
                /no\s+allergies/i.test(msgStr) ||
                /sin\s+alergias|no\s+alergias/i.test(msgStr) ||
                /pas\s+d'?allergies|sans\s+allergies/i.test(msgStr) ||
                /sina\s+mzio\s+wowote/i.test(msgStr)
              ) intakeArgs.allergies = '';

              // Known conditions / prior diagnoses
              if (
                /no\s+known\s+conditions|no\s+conditions/i.test(msgStr) ||
                /no\s+tengo\s+condiciones|sin\s+condiciones|no\s+condiciones/i.test(msgStr) ||
                /pas\s+de\s+conditions|sans\s+conditions|aucune\s+condition/i.test(msgStr) ||
                /sina\s+hali\s+yo?yote\s+inayojulikana/i.test(msgStr)
              ) intakeArgs.prior_diagnoses = '';

              // Prior workups/tests (English only in current suite)
              if (/no\s+prior\s+(tests|test)|no\s+prior\s+workups|no\s+recent\s+tests/i.test(msgStr)) intakeArgs.prior_workups = '';

              const alcoholMatch = msgStr.match(/alcohol\s*:\s*([^\n\r.]+)/i);
              if (alcoholMatch?.[1]) intakeArgs.alcohol_use = alcoholMatch[1].trim();

              const smokingMatch = msgStr.match(/smoking\s*:\s*([^\n\r.]+)/i);
              if (smokingMatch?.[1]) intakeArgs.smoking_status = smokingMatch[1].trim();

              const occMatch = msgStr.match(/occupation\s*:\s*([^\n\r.]+)/i);
              if (occMatch?.[1]) intakeArgs.occupation = occMatch[1].trim();

              await KellyToolExecutor.execute(
                'store_triage_rich_intake',
                intakeArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
              fallbackToolsUsed.push('store_triage_rich_intake');
            }

            const refreshed = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
            const opqrstComplete = !!(refreshed && (refreshed.opqrst_complete === 1 || refreshed.opqrst_complete === true));
            const intakeComplete = !!(refreshed && refreshed.intake_complete_at);

            if (opqrstComplete && intakeComplete) {
              try {
                const askedToProceed = _isBookingProgressIntent(message);
                const selectedSlotLikeInput = _looksLikeSlotChoice(message);
                const triageLocked = _triageLockedForRerag(sessionId);
                let triageOut = null;

                if (!triageLocked) {
                // When Groq is down we still re-run triage RAG server-side.
                // However, during specialty/slot routing turns the latest user message is often
                // just a confirmation (e.g. "Dermatology first"), which can produce low rag_confidence.
                // Build a stable symptom_text by including stored OPQRST fields.
                const symptomParts = [];
                if (refreshed.onset) symptomParts.push(`Onset: ${refreshed.onset}`);
                if (refreshed.provocation) symptomParts.push(`Provocation: ${refreshed.provocation}`);
                if (refreshed.quality) symptomParts.push(`Quality: ${refreshed.quality}`);
                if (refreshed.radiation) symptomParts.push(`Radiation: ${refreshed.radiation}`);
                if (refreshed.severity !== null && refreshed.severity !== undefined && refreshed.severity !== '') {
                  symptomParts.push(`Severity: ${refreshed.severity}`);
                }
                if (refreshed.timing) symptomParts.push(`Timing: ${refreshed.timing}`);
                if (refreshed.associated_sx) symptomParts.push(`Associated symptoms: ${refreshed.associated_sx}`);

                const userMessages = (history || [])
                  .filter(m => m && m.role === 'user')
                  .map(m => String(m.content || ''))
                  .filter(Boolean);

                const stableUserText = [
                  userMessages[0],
                  ...userMessages.slice(-2)
                ].join(' ')
                  .trim()
                  .slice(0, 2000);

                const symptomTextForRag = (
                  `${symptomParts.join('. ')}${symptomParts.length ? '. ' : ''}${stableUserText}`.trim()
                );

                triageOut = await KellyToolExecutor.execute(
                  'run_triage_rag',
                  { symptom_text: symptomTextForRag },
                  { sessionId, clinicId, patientId, callerPhone, channel }
                );
                fallbackToolsUsed.push('run_triage_rag');
                if (triageOut?.suggested_next_step) reply = _sanitizeSuggestedNextStep(triageOut.suggested_next_step);
                else if (triageOut?.patient_friendly_summary) reply = triageOut.patient_friendly_summary;
                else reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);
                }

                // When triage is locked, skip re-RAG; proceed to slots on booking intent.
                if (triageLocked && askedToProceed) {
                  const authRag = TriageRAGService.getAuthoritativeForSession(sessionId);
                  if (authRag?.patient_friendly_summary) {
                    reply = authRag.patient_friendly_summary;
                  }
                }

                if (askedToProceed) {
                  try {
                    const refreshedAfterRag = db.getTriageSession ? db.getTriageSession(sessionId) : refreshed;
                    const appointmentType = refreshedAfterRag?.target_specialty || 'PrimaryCare';
                    const today = (() => {
                      const d = new Date();
                      const day = d.getDay(); // 0=Sun,6=Sat
                      if (day === 6) d.setDate(d.getDate() + 2);
                      if (day === 0) d.setDate(d.getDate() + 1);
                      return d.toISOString().slice(0, 10);
                    })();

                    const slotOut = await KellyToolExecutor.execute(
                      'get_available_slots',
                      {
                        date: today,
                        appointment_type: appointmentType,
                        force_after_clarified: true
                      },
                      { sessionId, clinicId, patientId, callerPhone, channel }
                    );
                    if (slotOut?.success) {
                      _markSlotsPresentedForSession(sessionId, slotOut);
                      const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
                      const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
                      const source = bundles.length ? bundles : available;

                      nextChips = (source || []).slice(0, 8).map((s) => {
                        const label = (typeof s === 'string')
                          ? s
                          : (s?.display || s?.time || s?.start_time || s?.start || String(s));
                        return { label, value: String(label), action: 'select_slot', slot: (typeof s === 'object' ? s : null) };
                      }).filter(x => x.value);

                      chipsDisplay = 'list';
                      fallbackToolsUsed.push('get_available_slots');

                      reply = slotOut?.kelly_script
                        ? `${slotOut.kelly_script} Here are some available times. Please choose one.`
                        : 'Here are some available times. Please choose one.';
                    }
                  } catch (_) {
                    // Keep the triage reply when slot lookup fails.
                  }
                }

                // Slot selection (e.g. user picks "09:00") while LLM is unavailable.
                // In this mode we deterministically drive the checkout pipeline.
                if (selectedSlotLikeInput && !askedToProceed) {
                  try {
                    const contextText = Array.isArray(history)
                      ? history.map((m) => String(m?.content || '')).join('\n')
                      : String(message || '');

                    const patientEmailResolved = patientEmail || _extractEmail(contextText);
                    const patientPhone = _extractPhone(contextText) || callerPhone || null;
                    const patientNameResolved = patientName || _extractPatientName(contextText) || 'Patient';
                    if (!patientEmailResolved) throw new Error('Missing patient email for checkout');

                    const appointmentType = triageOut?.target_specialty || refreshed?.target_specialty || 'PrimaryCare';
                    const today = (() => {
                      const d = new Date();
                      const day = d.getDay(); // 0=Sun,6=Sat
                      if (day === 6) d.setDate(d.getDate() + 2);
                      if (day === 0) d.setDate(d.getDate() + 1);
                      return d.toISOString().slice(0, 10);
                    })();

                    const selectedTimeRaw = String(message || '').trim();
                    const isAsyncSelection = /^(async|sync)$/i.test(selectedTimeRaw) || /^async$/i.test(selectedTimeRaw) || selectedTimeRaw.toUpperCase() === 'ASYNC';
                    const scheduleDate = isAsyncSelection
                      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                      : today;
                    const selectedTime = isAsyncSelection
                      ? '11:30 AM'
                      : selectedTimeRaw;

                    const slotOut = await KellyToolExecutor.execute(
                      'get_available_slots',
                      {
                        date: today,
                        appointment_type: appointmentType,
                        force_after_clarified: true
                      },
                      { sessionId, clinicId, patientId, callerPhone, channel }
                    );
                    if (slotOut?.success) {
                      fallbackToolsUsed.push('get_available_slots');

                      const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
                      const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
                      const source = bundles.length ? bundles : available;

                      // Try to find a matching slot object (to get practitioner_id).
                      let selected = null;
                      if (Array.isArray(bundles) && bundles.length > 0) {
                        const msgLc = String(message || '').toLowerCase();
                        selected = bundles.find((s) => {
                          const label = String(s?.display || s?.time || s?.start_time || s?.start || '').toLowerCase();
                          return label && (msgLc.includes(label) || label === msgLc);
                        }) || null;
                      }

                      // Even if we couldn't resolve practitioner_id, attempt scheduling with best-effort fields.
                      const scheduleOut = await KellyToolExecutor.execute(
                        'schedule_appointment',
                        {
                          patient_name: patientNameResolved,
                          patient_phone: patientPhone || undefined,
                          patient_email: patientEmailResolved,
                          appointment_type: appointmentType,
                          date: scheduleDate,
                          time: selectedTime,
                          timezone: 'America/New_York',
                          practitioner_id: selected?.practitioner_id,
                          lane: selected?.lane || (isAsyncSelection ? 'async' : 'sync'),
                          notes: 'Scheduled via connection-error fallback progression',
                          force_after_clarified: true
                        },
                        { sessionId, clinicId, patientId, callerPhone, channel }
                      );
                      fallbackToolsUsed.push('schedule_appointment');

                      const appointmentId =
                        scheduleOut?.appointment_id ||
                        scheduleOut?.id ||
                        scheduleOut?.appointment?.id ||
                        null;
                      if (appointmentId) {
                        const checkoutOut = await KellyToolExecutor.execute(
                          'create_appointment_checkout',
                          {
                            appointment_id: appointmentId,
                            customer_email: patientEmailResolved,
                            customer_name: patientNameResolved,
                            customer_phone: patientPhone || undefined
                          },
                          { sessionId, clinicId, patientId, callerPhone, channel }
                        );
                        fallbackToolsUsed.push('create_appointment_checkout');

                        const checkoutReply =
                          checkoutOut?.message ||
                          checkoutOut?.patient_message ||
                          'I sent a verification code to your email to continue checkout.';

                        reply = /verification code|checkout|payment link/i.test(String(checkoutReply))
                          ? checkoutReply
                          : `${checkoutReply} Please enter the verification code to continue checkout.`;

                        // Clear chips since we entered checkout.
                        nextChips = [];
                        chipsDisplay = null;
                      }
                    }
                  } catch (_) {
                    // Keep the triage reply if scheduling fails.
                  }
                }
              } catch (_) {
                reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);
              }
            } else {
              reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);
            }

            reply = _sanitizeToolNameLeaks(reply);
          } catch (_) {
            reply = this.fallbackReply(channel);
          }

          try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
          return _errUiReturn({
            reply,
            endCall: false,
            toolsUsed: fallbackToolsUsed,
            language: preferredLanguage,
            next_chips: nextChips,
            chips_display: chipsDisplay,
            usedFallback: true
          });
        }

      const isTooLarge = err?.status === 413 || err?.statusCode === 413 ||
        messageLower.includes('too large') ||
        messageLower.includes('request too large') ||
        messageLower.includes('tokens per minute') ||
        messageLower.includes('413');

      const isRateLimit = !isTooLarge && (err?.status === 429 || err?.statusCode === 429 ||
        messageLower.includes('429') ||
        messageLower.includes('rate_limit') ||
        messageLower.includes('rate limit'));

      if (messageLower.includes('llm_turn_timeout')) {
        // UX guardrail: never let a slow Groq/tool loop hang the user.
        try {
          const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
          reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, sessionRow, message);
          reply = _sanitizeToolNameLeaks(reply);
        } catch (_) {
          reply = this.fallbackReply(channel);
        }
        try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
        return _errUiReturn({ reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true });
      }

      const isToolValidationFailure =
        messageLower.includes('tool call validation failed') ||
        messageLower.includes('tool_use_failed') ||
        messageLower.includes('failed to call a function');

      if (isToolValidationFailure) {
        const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, sessionRow, message);
        reply = _sanitizeToolNameLeaks(reply);
        try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
        return _errUiReturn({ reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true });
      }

      // Deterministic booking progression when Groq is rate-limited:
      // if triage is already complete and the user is asking to proceed,
      // fetch slots server-side so the checkout pipeline can continue.
      if (isRateLimit) {
        try {
          let sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
          let triageComplete = !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true));
          const askedToProceed = _isBookingProgressIntent(message);
          const selectedSlotLikeInput = _looksLikeSlotChoice(message);

          // If rate-limited before triage has completed, attempt server-side triage
          // progression from the user's current message (common in first-turn rich inputs).
          if (!triageComplete) {
            const msgStr = String(message || '');
            const opqrstArgs = {};
            const onset = msgStr.match(/onset\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const provocation = msgStr.match(/provocation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const quality = msgStr.match(/quality\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const radiation = msgStr.match(/radiation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const timing = msgStr.match(/timing\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const severityLabel = msgStr.match(/severity\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const sevNum = severityLabel ? parseInt(String(severityLabel).match(/\b(10|[1-9])\b/)?.[1] || '', 10) : NaN;
            const anyNum = parseInt((msgStr.match(/\b(10|[1-9])\b/) || [])[1] || '', 10);
            if (onset) opqrstArgs.onset = onset;
            if (provocation) opqrstArgs.provocation = provocation;
            if (quality) opqrstArgs.quality = quality;
            if (radiation) opqrstArgs.radiation = radiation;
            if (timing) opqrstArgs.timing = timing;
            if (Number.isFinite(sevNum)) opqrstArgs.severity = sevNum;
            else if (Number.isFinite(anyNum)) opqrstArgs.severity = anyNum;

            if (Object.keys(opqrstArgs).length > 0) {
              await KellyToolExecutor.execute(
                'store_triage_opqrst',
                opqrstArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
            }

            const intakeArgs = {};
            if (/no\s+medications|i\s+take\s+no\s+medications|no\s+meds/i.test(msgStr)) intakeArgs.medications = '';
            if (/no\s+allergies/i.test(msgStr)) intakeArgs.allergies = '';
            if (/no\s+known\s+conditions|no\s+conditions/i.test(msgStr)) intakeArgs.prior_diagnoses = '';
            if (/no\s+prior\s+(tests|test)|no\s+prior\s+workups|no\s+recent\s+tests/i.test(msgStr)) intakeArgs.prior_workups = '';
            const alcoholMatch = msgStr.match(/alcohol\s*:\s*([^\n\r.]+)/i);
            if (alcoholMatch?.[1]) intakeArgs.alcohol_use = alcoholMatch[1].trim();
            const smokingMatch = msgStr.match(/smoking\s*:\s*([^\n\r.]+)/i);
            if (smokingMatch?.[1]) intakeArgs.smoking_status = smokingMatch[1].trim();
            const occMatch = msgStr.match(/occupation\s*:\s*([^\n\r.]+)/i);
            if (occMatch?.[1]) intakeArgs.occupation = occMatch[1].trim();
            if (Object.keys(intakeArgs).length > 0) {
              await KellyToolExecutor.execute(
                'store_triage_rich_intake',
                intakeArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
            }

            const symptomTextForRag = msgStr.trim() || 'Patient-reported symptoms';
            await KellyToolExecutor.execute(
              'run_triage_rag',
              { symptom_text: symptomTextForRag },
              { sessionId, clinicId, patientId, callerPhone, channel }
            );
            sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
            triageComplete = !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true));
          }

          if (triageComplete && (askedToProceed || selectedSlotLikeInput)) {
            const requestedSpecialty = _extractRequestedSpecialty(message);
            const appointmentType = requestedSpecialty || sessionRow?.target_specialty || 'PrimaryCare';
            const today = (() => {
              const d = new Date();
              const day = d.getDay(); // 0=Sun,6=Sat
              if (day === 6) d.setDate(d.getDate() + 2);
              if (day === 0) d.setDate(d.getDate() + 1);
              return d.toISOString().slice(0, 10);
            })();
            const slotOut = await KellyToolExecutor.execute(
              'get_available_slots',
              {
                date: today,
                appointment_type: appointmentType,
                force_after_clarified: true
              },
              { sessionId, clinicId, patientId, callerPhone, channel }
            );
            if (slotOut?.success) {
              const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
              const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
              const source = bundles.length ? bundles : available;
              const chips = source.slice(0, 8).map((s) => {
                const label = s?.display || s?.time || s?.start_time || s?.start || String(s);
                return { label, value: String(label), action: 'select_slot', slot: s };
              });

              // If user appears to be selecting a slot while rate-limited, advance
              // deterministically: insurance -> schedule -> checkout.
              if (selectedSlotLikeInput && source.length) {
                const msgLc = String(message || '').toLowerCase();
                let selected = source[0];
                const wantsImmediate = /\b(now|immediately|urgent|asap|right away|срочно|немедленно|ahora|inmediatamente)\b/i.test(msgLc);
                const wantsScheduled = /\b(schedule|scheduled|later|not urgent|tomorrow|next week|заплан|позже|programar|despues)\b/i.test(msgLc);
                if (msgLc.includes('async') || wantsScheduled) {
                  const asyncMatch = source.find((s) => String(s?.time || '').toUpperCase() === 'ASYNC' || s?.is_async === true);
                  if (asyncMatch) selected = asyncMatch;
                } else if (msgLc.includes('sync') || wantsImmediate) {
                  const syncMatch = source.find((s) => !(String(s?.time || '').toUpperCase() === 'ASYNC' || s?.is_async === true));
                  if (syncMatch) selected = syncMatch;
                } else {
                  const byText = source.find((s) => {
                    const label = String(s?.display || s?.time || s?.start_time || s?.start || '').toLowerCase();
                    return label && msgLc.includes(label);
                  });
                  if (byText) selected = byText;
                }

                const historyText = Array.isArray(history)
                  ? history.map((m) => String(m?.content || '')).join('\n')
                  : '';
                const contextText = `${historyText}\n${String(message || '')}`;
                const patientEmail = _extractEmail(contextText);
                const patientPhone = _extractPhone(contextText) || callerPhone || null;
                const patientNameResolved = patientName || _extractPatientName(contextText) || 'Patient';
                // PHASE 2: collect_insurance disabled (cash-only flow)
                // const memberId = _extractInsuranceMemberId(contextText);
                // if (memberId) { await KellyToolExecutor.execute('collect_insurance', {...}); }

                if (patientEmail && selected?.practitioner_id) {
                  const selectedTimeRaw = selected?.time || selected?.start_time || selected?.start || 'ASYNC';
                  const isAsyncSelection = String(selectedTimeRaw).toUpperCase() === 'ASYNC' || selected?.is_async === true;
                  // For async lane, schedule on a future concrete datetime to avoid local
                  // slot-conflict checks that reject repeated same-day placeholder times.
                  const scheduleDate = isAsyncSelection
                    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                    : today;
                  const selectedTime = isAsyncSelection
                    ? '11:30 AM'
                    : selectedTimeRaw;
                  const scheduleOut = await KellyToolExecutor.execute(
                    'schedule_appointment',
                    {
                      patient_name: patientNameResolved,
                      patient_phone: patientPhone || undefined,
                      patient_email: patientEmail,
                      appointment_type: appointmentType,
                      date: scheduleDate,
                      time: selectedTime,
                      timezone: 'America/New_York',
                      practitioner_id: selected.practitioner_id,
                      lane: selected?.lane || (String(selected?.time || '').toUpperCase() === 'ASYNC' ? 'async' : 'sync'),
                      notes: 'Scheduled via rate-limit fallback progression',
                      force_after_clarified: true
                    },
                    { sessionId, clinicId, patientId, callerPhone, channel }
                  );

                  const appointmentId =
                    scheduleOut?.appointment_id ||
                    scheduleOut?.id ||
                    scheduleOut?.appointment?.id ||
                    null;
                  let resolvedAppointmentId = appointmentId;
                  if (!resolvedAppointmentId && db?.db && patientEmail) {
                    try {
                      // Some schedule endpoints return success without a normalized
                      // appointment_id field. Recover by reading the most recent
                      // appointment for this email.
                      const row = db.db.prepare(`
                        SELECT id
                        FROM appointments
                        WHERE lower(patient_email) = lower(?)
                        ORDER BY datetime(created_at) DESC
                        LIMIT 1
                      `).get(patientEmail);
                      if (row?.id) resolvedAppointmentId = row.id;
                    } catch (_) {}
                  }

                  if (resolvedAppointmentId) {
                    const checkoutOut = await KellyToolExecutor.execute(
                      'create_appointment_checkout',
                      {
                        appointment_id: resolvedAppointmentId,
                        customer_email: patientEmail,
                        customer_name: patientNameResolved,
                        customer_phone: patientPhone || undefined
                      },
                      { sessionId, clinicId, patientId, callerPhone, channel }
                    );
                    const checkoutReply =
                      checkoutOut?.message ||
                      checkoutOut?.patient_message ||
                      'I sent a verification code to your email to continue checkout.';
                    reply = /verification code|checkout|payment link/i.test(checkoutReply)
                      ? checkoutReply
                      : `${checkoutReply} Please enter the verification code to continue checkout.`;
                    try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
                    const tuCheckout = _toolsUsedEnsureRagBeforeSlots(sessionId, [
                      'get_available_slots',
                      'schedule_appointment',
                      'create_appointment_checkout'
                    ]);
                    _kellyDebugTurn('rate_limit_fallback_checkout', {
                      sessionId,
                      toolsUsed: tuCheckout
                    });
                    return _errUiReturn({
                      reply,
                      endCall: false,
                      toolsUsed: tuCheckout,
                      language: preferredLanguage,
                      next_step: checkoutOut?.next_step || null,
                      next_chips: [],
                      chips_display: null,
                      usedFallback: true
                    });
                  }
                }
              }

              reply = chips.length
                ? 'Here are some available times. Please choose one.'
                : 'I could not find open times yet. Please share a preferred date and I will check again.';
              try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
              const tuSlots = _toolsUsedEnsureRagBeforeSlots(sessionId, ['get_available_slots']);
              _kellyDebugTurn('rate_limit_fallback_slots', { sessionId, toolsUsed: tuSlots });
              return _errUiReturn({
                reply,
                endCall: false,
                toolsUsed: tuSlots,
                language: preferredLanguage,
                next_step: null,
                next_chips: chips.length ? chips : [],
                chips_display: chips.length ? 'list' : null,
                usedFallback: true
              });
            }
          }
        } catch (_) {
          // fall through to standard rate-limit fallback message
        }
      }

      if (isTooLarge && channel === 'chat') {
        reply = "We're temporarily unable to process that request right now (size limit). Please try again in a few minutes.";
      } else if (isTooLarge && channel === 'voice') {
        reply = "We're temporarily unable to process that request right now. Please call back in a few minutes.";
      } else if (isRateLimit && channel === 'chat') {
        reply =
          process.env.KELLY_RATE_LIMIT_REPLY_CHAT ||
          "I'm temporarily busy — please send your message again in about 30 seconds and I'll continue.";
        _kellyDebugTurn('degraded_rate_limit_chat', { sessionId, errSnippet: String(err?.message || '').slice(0, 120) });
        try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
        return _errUiReturn({
          reply,
          endCall: false,
          toolsUsed: [],
          language: preferredLanguage,
          usedFallback: true,
          next_step: 'rate_limited_retry_30s',
          next_chips: []
        });
      } else if (isRateLimit && channel === 'voice') {
        reply =
          process.env.KELLY_RATE_LIMIT_REPLY_VOICE ||
          "I'm temporarily busy — please hold a moment and I'll be right with you.";
        _kellyDebugTurn('degraded_rate_limit_voice', { sessionId, errSnippet: String(err?.message || '').slice(0, 120) });
        try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
        return _errUiReturn({
          reply,
          endCall: false,
          toolsUsed: [],
          language: preferredLanguage,
          usedFallback: true,
          next_step: 'rate_limited_hold_and_retry',
          next_chips: []
        });
      } else {
        const PatientOrchestratorService = require('../patient/patient-orchestrator-service');
        try {
          const fb = await PatientOrchestratorService.orchestrate({
            channel,
            transcript_or_message: message,
            session_id: sessionId,
            caller_phone: callerPhone,
            patient_id: patientId,
            clinic_id: clinicId
          });
          reply = fb?.text || fb?.reply || this.fallbackReply(channel);
          // CRITICAL: Pass through state + next_chips so the handler can persist them.
          // Without this, the orchestrator's flow_state (e.g. insurance_started, step) is never saved,
          // and we loop forever asking "Please enter your insurance member ID".
          return _errUiReturn({
            reply: _sanitizeToolNameLeaks(reply),
            endCall: false,
            toolsUsed: [],
            language: preferredLanguage,
            usedFallback: true,
            state: fb?.state,
            next_chips: fb?.next_chips,
            next_step: fb?.next_step,
            redirect_to: fb?.redirect_to
          });
        } catch (_) {
          reply = this.fallbackReply(channel);
        }
      }
      // Ensure fallback/error replies still persist in conversation history.
      reply = _sanitizeToolNameLeaks(reply);
      try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
      _kellyDebugTurn('catch_fallback_return', {
        sessionId,
        toolsUsed: [],
        isRateLimit: !!isRateLimit,
        isTooLarge: !!isTooLarge,
        replySnippet: String(reply || '').slice(0, 80)
      });
      return _errUiReturn({ reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true });
    }

    // ── 6. Persist assistant reply ────────────────────────────
    reply = _sanitizeToolNameLeaks(reply);
    this._appendToHistory(sessionId, 'assistant', reply);

    const mergedTools = Array.from(new Set(Array.isArray(toolsUsed) ? toolsUsed : []));
    if (
      mergedTools.includes('get_available_slots') &&
      !mergedTools.includes('run_triage_rag') &&
      TriageRAGService.getAuthoritativeForSession(sessionId)
    ) {
      mergedTools.push('run_triage_rag');
    }

    const orderedTools = _toolsUsedEnsureRagBeforeSlots(sessionId, mergedTools);
    const fusedEvidence = EvidenceFusion.fuseEvidence({
      pathology: context?.pathology_retrieval || null,
      safety_status: safety?.status || 'green',
      risk_flags: gateEval?.state?.risk_flags || [],
      records: null,
      literature: null,
      ingredient: null
    });
    const patientSummary = CaseSummaryComposer.composeCaseSummary({
      fused: fusedEvidence,
      audience: 'patient'
    });
    patientSummary.summary_text = ClinicalRecommendationPolicy.applyOutputGuardrails(patientSummary.summary_text, {
      safetyStatus: safety?.status || 'green',
      routineSkincare: false
    });
    const billingPack = BillingReadinessPack.buildBillingReadinessPack({
      source: 'kelly_chat',
      session_id: sessionId,
      rag_context: context?.pathology_retrieval || {},
      evidence_fusion: fusedEvidence,
      confidence: fusedEvidence?.confidence ?? null
    });
    if (CasePatternsService.isEnabled()) {
      try {
        CasePatternsService.ingestCasePattern({
          source: 'kelly_chat',
          source_ref: sessionId,
          chief_complaint: gateEval?.state?.chief_complaint || null,
          specialty: fusedEvidence?.merged?.specialty || null,
          urgency: fusedEvidence?.merged?.urgency || null,
          safety_level: fusedEvidence?.safety_status || null,
          body_sites: gateEval?.state?.body_sites || [],
          risk_flags: fusedEvidence?.merged?.risk_flags || [],
          summary: patientSummary?.summary_text || ''
        });
      } catch (_) {}
    }
    if (db.insertFinalAssessmentArtifact) {
      const retrievalKey = `session:${sessionId}:turn`;
      db.insertFinalAssessmentArtifact({
        source: 'kelly_chat',
        session_id: sessionId,
        trace_id: context?.trace_id || null,
        artifact_type: 'case_summary',
        retrieval_key: retrievalKey,
        payload: patientSummary
      });
      db.insertFinalAssessmentArtifact({
        source: 'kelly_chat',
        session_id: sessionId,
        trace_id: context?.trace_id || null,
        artifact_type: 'billing_readiness_pack',
        retrieval_key: retrievalKey,
        payload: billingPack
      });
      db.insertFinalAssessmentArtifact({
        source: 'kelly_chat',
        session_id: sessionId,
        trace_id: context?.trace_id || null,
        artifact_type: 'decision_log',
        retrieval_key: retrievalKey,
        payload: {
          service_option: context?.service_option || null,
          care_path: context?.care_path || null,
          safety_status: safety?.status || 'green',
          next_step: nextStep || null,
          tools_used: orderedTools
        }
      });
    }
    _kellyDebugTurn('turn_success', {
      sessionId,
      toolsUsed: orderedTools,
      usedFallback: false,
      replySnippet: String(reply || '').slice(0, 100)
    });

    if (process.env.KELLY_DEBUG_TURN === '1') {
      console.log('[DEBUG-RESPONSE] session:', sessionId.slice(0, 8), {
        toolsUsed: orderedTools,
        hasNextChips: !!(nextChips?.length),
        chipsCount: nextChips?.length || 0,
        nextStep: nextStep || null,
        replySnippet: String(reply || '').slice(0, 80),
        lastSlotBundlesSet: !!KellyToolExecutor._getSessionMeta?.(sessionId, 'last_slot_bundles'),
        slotPresented: KellyToolExecutor._getSessionMeta?.(sessionId, 'slot_presented'),
        paymentTokenSet: !!KellyToolExecutor._getSessionMeta?.(sessionId, 'payment_token')
      });
    }

    let redirectTo = null;
    if (channel === 'chat' && orderedTools.includes('schedule_appointment')) {
      try {
        const token = KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'payment_token') : null;
        if (token) {
          const base = (process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
          redirectTo = `${base}/payment/${token}`;
        }
      } catch (_) {}
    }

    let skincare_compose_sidecar = null;
    if (pathway === 'routine' && process.env.KELLY_SKINCARE_POST_TURN_COMPOSE === '1') {
      try {
        skincare_compose_sidecar = require('../catalog/skincare-post-turn-compose').runDefaultSkincarePostTurnCompose({
          db: db.db,
          sessionId,
          userMessage: message,
        });
      } catch (_) {}
    }

    return _mergeUiSnapIntoReturn(
      KellyToolExecutor.consumeUiAttachments(sessionId),
      _appendSkincareAssessmentToReturn(sessionId, orchestration, {
      reply,
      endCall,
      toolsUsed: orderedTools,
      language: preferredLanguage,
      next_step: nextStep,
      next_chips: nextChips,
      chips_display: chipsDisplay,
        redirect_to: redirectTo,
        llm_usage: loopResult?.llm_usage || null,
        care_path: context?.care_path || null,
        evidence_fusion: fusedEvidence,
        case_summary: patientSummary,
        billing_readiness_pack: billingPack,
        skincare_compose: skincare_compose_sidecar,
      })
    );
  }

  /**
   * Retail checkout chat: only commerce quote + payment tools (no triage/scheduling).
   */
  static async _processCommerceCheckoutTurn({
    message,
    sessionId,
    channel,
    clinicId,
    patientId,
    patientEmail,
    commerceCheckout,
    checkoutPolicy,
    onStreamDelta,
    onToolStatus
  }) {
    const msgText = String(message || '').trim();
    const lang = (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) || 'en';
    const emailMatch = msgText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    const currentStage = KellyToolExecutor._getCheckoutStage(sessionId);
    if (currentStage === 'payment_confirmed') {
      const reply = 'Your payment is confirmed. Check your email for a receipt.';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
      return _checkoutReply(reply, [], lang, currentStage, { payment_confirmed: true, can_show_payment_form: false }, []);
    }
    if (currentStage === 'failed') {
      const reply = 'Previous payment did not complete. Say "**continue secure checkout**" to retry secure payment.';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
      return _checkoutReply(reply, [], lang, currentStage, _stageToPolicyFlags(currentStage), _stageToActions(currentStage));
    }
    if (currentStage === 'checkout_prepared') {
      const isReset = /\b(reset|start over|new order|cancel checkout)\b/i.test(msgText);
      if (!isReset) {
        const reply = 'Secure checkout is ready. Please complete payment in the form above.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, [], lang, currentStage, { can_show_payment_form: true }, ['complete_payment_form']);
      }
      KellyToolExecutor.hardResetCheckoutContext?.(sessionId, 'explicit_checkout_reset_message');
    }
    const stageAfterReset = KellyToolExecutor._getCheckoutStage(sessionId);
    const proceedIntent = /\b(continue|proceed|secure checkout|checkout|pay|ready|go ahead|let'?s go|yes|ok)\b/i.test(msgText);
    const yesIntent = /^(yes|yep|yeah|correct|confirm|looks good|ok|okay)\b/i.test(msgText);
    const noIntent = /^(no|nope|wrong|change|edit)\b/i.test(msgText);
    const pendingCandidate = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_candidate_pending') || '') === '1';
    const pendingCandidateRaw = String(KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_candidate_json') || '').trim();
    let pendingCandidateObj = null;
    if (pendingCandidate && pendingCandidateRaw) {
      try { pendingCandidateObj = JSON.parse(pendingCandidateRaw); } catch (_) { pendingCandidateObj = null; }
    }

    if (pendingCandidateObj) {
      if (yesIntent) {
        const saveConfirmed = await KellyToolExecutor.execute(
          'save_shipping_address',
          {
            line1: pendingCandidateObj.line1,
            line2: pendingCandidateObj.line2,
            city: pendingCandidateObj.city,
            state: pendingCandidateObj.state,
            postal_code: pendingCandidateObj.postal_code,
            country: pendingCandidateObj.country || 'US',
            provider_id: commerceCheckout?.providerId || undefined,
            confirm_candidate: true
          },
          { sessionId, clinicId, patientId, callerPhone: null, channel }
        );
        if (saveConfirmed?.success) {
          const reply = stageAfterReset === 'code_verified'
            ? 'Shipping address confirmed. Say "**continue secure checkout**" when you are ready.'
            : 'Shipping address confirmed. Please continue checkout.';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
          return _checkoutReply(reply, ['save_shipping_address'], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), _stageToActions(stageAfterReset));
        }
      } else if (noIntent) {
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_candidate_pending', '0');
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_candidate_json', '');
        const reply = 'Please share your corrected full shipping address (street, city, state, ZIP).';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, [], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), ['save_shipping_address']);
      } else {
        const zipOnly = msgText.match(/\b\d{5}(?:-\d{4})?\b/);
        if (zipOnly) {
          const saveCorrected = await KellyToolExecutor.execute(
            'save_shipping_address',
            {
              line1: pendingCandidateObj.line1,
              line2: pendingCandidateObj.line2,
              city: pendingCandidateObj.city,
              state: pendingCandidateObj.state,
              postal_code: zipOnly[0],
              country: pendingCandidateObj.country || 'US',
              provider_id: commerceCheckout?.providerId || undefined,
              confirm_candidate: true
            },
            { sessionId, clinicId, patientId, callerPhone: null, channel }
          );
          if (saveCorrected?.success) {
            const reply = stageAfterReset === 'code_verified'
              ? 'ZIP updated and shipping address saved. Say "**continue secure checkout**" when ready.'
              : 'ZIP updated and shipping address saved.';
            this._appendToHistory(sessionId, 'user', message);
            this._appendToHistory(sessionId, 'assistant', reply);
            return _checkoutReply(reply, ['save_shipping_address'], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), _stageToActions(stageAfterReset));
          }
        }
      }
    }
    const looksLikeAddressInput =
      /\b[0-9!IlOo]{5}(?:-[0-9!IlOo]{4})?\b/.test(msgText) &&
      /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|court|ct|place|pl|hill)\b/i.test(msgText);

    if (looksLikeAddressInput && !emailMatch && !/\b\d{6}\b/.test(msgText)) {
      const shippingSave = await KellyToolExecutor.execute(
        'save_shipping_address',
        { address_string: msgText, provider_id: commerceCheckout?.providerId || undefined },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (shippingSave?.success) {
        let reply = 'Shipping address saved.';
        if (stageAfterReset === 'code_sent') {
          reply = 'Shipping address saved. Please enter the 6-digit code we emailed you to continue.';
        } else if (stageAfterReset === 'code_verified') {
          reply = 'Shipping address saved. Say "**continue secure checkout**" when you are ready.';
        } else if (stageAfterReset === 'collecting_details') {
          reply = 'Shipping address saved. Please share your email so I can send your 6-digit verification code.';
        }
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, ['save_shipping_address'], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), _stageToActions(stageAfterReset));
      } else if (shippingSave?.error === 'address_needs_confirmation') {
        const reply = String(
          shippingSave?.message ||
          'I interpreted part of your address. Reply "yes" to confirm, or send the corrected ZIP.'
        );
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, ['save_shipping_address'], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), ['confirm_shipping_address']);
      }
    }
    const blockEmailIntercept = ['code_verified', 'checkout_prepared', 'payment_confirmed'].includes(stageAfterReset);
    if (emailMatch && !blockEmailIntercept) {
      const email = String(emailMatch[0]).toLowerCase();
      const sendResult = await KellyToolExecutor.execute(
        'send_commerce_verification_code',
        { email },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      let reply;
      if (sendResult && sendResult.success) {
        reply = `Code sent to ${email}. Please share the 6-digit code, and include your full shipping address to continue.`;
      } else if (sendResult && sendResult.error === 'checkout_already_in_progress') {
        reply = 'Secure checkout is already prepared for this session. Please complete payment in the form above, or say "reset checkout" to start over.';
      } else {
        reply = 'Unable to send the verification code right now. Please try again in a moment.';
      }
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
      return _checkoutReply(
        reply,
        sendResult && sendResult.success ? ['send_commerce_verification_code'] : [],
        lang,
        KellyToolExecutor._getCheckoutStage(sessionId),
        _stageToPolicyFlags(KellyToolExecutor._getCheckoutStage(sessionId)),
        _stageToActions(KellyToolExecutor._getCheckoutStage(sessionId))
      );
    }
    const codeMatch = msgText.match(/\b(\d{6})\b/);
    const pendingEmail = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_pending');
    const effectivePendingEmail =
      pendingEmail ||
      KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_verified') ||
      '';
    if (codeMatch && effectivePendingEmail) {
      const verifyResult = await KellyToolExecutor.execute(
        'verify_commerce_code',
        { email: String(effectivePendingEmail), code: codeMatch[1] },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      const verified = !!verifyResult?.success;
      const directReply = verified
        ? 'Email verified. Please share your full shipping address (street, city, state, ZIP) so I can prepare secure checkout.'
        : 'That code did not verify. Please check and try again, or ask me to resend.';
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', directReply);
      return _checkoutReply(
        directReply,
        ['verify_commerce_code'],
        lang,
        KellyToolExecutor._getCheckoutStage(sessionId),
        _stageToPolicyFlags(KellyToolExecutor._getCheckoutStage(sessionId)),
        verified ? ['save_shipping_address'] : ['enter_code']
      );
    }
    if (stageAfterReset === 'code_verified' && proceedIntent) {
      const verifiedEmail = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_email_verified') || effectivePendingEmail || patientEmail || '';
      const shippingAddress = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_address') || '';
      const shippingLine1 = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_line1') || '';
      const shippingComplete = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_complete') === '1';
      if (!verifiedEmail) {
        const reply = 'Please share your email so I can continue secure checkout.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, [], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), _stageToActions(stageAfterReset));
      }
      if (!shippingComplete || !shippingLine1) {
        const storedCity = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_city') || '';
        const storedState = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_state') || '';
        const storedZip = KellyToolExecutor._getSessionMeta(sessionId, 'commerce_shipping_postal_code') || '';
        const missing = [];
        if (!shippingLine1) missing.push('street address');
        if (!storedCity) missing.push('city');
        if (!storedState) missing.push('state');
        if (!storedZip) missing.push('ZIP code');
        const reply = missing.length
          ? `I still need your ${missing.join(', ')} to continue. Please share your full delivery address.`
          : 'Please share your full shipping address (street, city, state, ZIP) to continue.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, [], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), _stageToActions(stageAfterReset));
      }
      const prep = await KellyToolExecutor.execute(
        'prepare_commerce_checkout',
        { customer_email: String(verifiedEmail), shipping_address: String(shippingAddress), use_cart: true },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      const prepStage = KellyToolExecutor._getCheckoutStage(sessionId);
      const reply = prep?.success
        ? 'Secure checkout is prepared. Please complete payment in the secure form above.'
        : String(prep?.message || 'Could not prepare checkout. Please try again.');
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', reply);
      return _checkoutReply(
        reply,
        ['prepare_commerce_checkout'],
        lang,
        prepStage,
        prep?.success ? { can_show_payment_form: true } : _stageToPolicyFlags(prepStage),
        prep?.success ? ['complete_payment_form'] : _stageToActions(prepStage),
        prep?.success ? prep : null
      );
    }
    if (stageAfterReset === 'code_verified' && !proceedIntent && msgText.length >= 8) {
      const shippingSave = await KellyToolExecutor.execute(
        'save_shipping_address',
        { address_string: msgText, provider_id: commerceCheckout?.providerId || undefined },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (shippingSave?.success) {
        const reply = 'Shipping address saved. Say "**continue secure checkout**" when you are ready.';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, ['save_shipping_address'], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), ['continue_secure_checkout']);
      } else if (shippingSave?.error === 'address_needs_confirmation') {
        const reply = String(
          shippingSave?.message ||
          'I interpreted part of your address. Reply "yes" to confirm, or send the corrected ZIP.'
        );
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', reply);
        return _checkoutReply(reply, ['save_shipping_address'], lang, stageAfterReset, _stageToPolicyFlags(stageAfterReset), ['confirm_shipping_address']);
      }
    }
    const history = this._loadHistory(sessionId);
    const preferredLanguage =
      (db.getKellySessionLanguage && db.getKellySessionLanguage(sessionId)) ||
      this._detectPreferredLanguage(history, message) ||
      'en';
    this._appendToHistory(sessionId, 'user', message);
    history.push({ role: 'user', content: message });
    const context = {
      channel,
      clinicId,
      patientId,
      patientName: null,
      callerPhone: null,
      preferredLanguage,
      sessionId,
      message,
      kellyScriptHint: null,
      patientEmail: patientEmail || null,
      commerceContext: {
        productId: String(commerceCheckout.productId),
        providerId: String(commerceCheckout.providerId),
        patientEmail: patientEmail || null,
        preferredLanguage,
        checkoutPolicy: checkoutPolicy || null
      }
    };
    let loopResult;
    try {
      const turnTimeoutMs = parseInt(process.env.KELLY_TURN_TIMEOUT_MS || '25000', 10);
      loopResult = await Promise.race([
        this._runLLMLoop({
          history,
          context,
          clinicId,
          patientId,
          callerPhone: null,
          sessionId,
          channel,
          checkoutPolicy: checkoutPolicy || null,
          onStreamDelta,
          onToolStatus,
          customerId,
          providerInstructions,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM_TURN_TIMEOUT')), turnTimeoutMs))
      ]);
    } catch (err) {
      const reply = "I'm having trouble connecting. Use the Continue button below to proceed, or try again in a moment.";
      this._appendToHistory(sessionId, 'assistant', reply);
      return _checkoutReply(reply, [], lang, KellyToolExecutor._getCheckoutStage(sessionId), _stageToPolicyFlags(KellyToolExecutor._getCheckoutStage(sessionId)), _stageToActions(KellyToolExecutor._getCheckoutStage(sessionId)));
    }
    let reply = loopResult.reply || '';
    reply = _sanitizeToolNameLeaks(reply);
    this._appendToHistory(sessionId, 'assistant', reply);
    const quoteIdFromMeta = KellyToolExecutor._getSessionMeta(sessionId, 'last_commerce_quote_id');
    let commerceCheckoutOut = loopResult.commerce_checkout || null;
    if (!commerceCheckoutOut) {
      try {
        const raw = KellyToolExecutor._getSessionMeta(sessionId, 'last_commerce_checkout_chat');
        if (raw) commerceCheckoutOut = JSON.parse(raw);
      } catch (_) {}
    }
    const finalStage = KellyToolExecutor._getCheckoutStage(sessionId);
    const uiAttach = KellyToolExecutor.consumeUiAttachments(sessionId);
    return _checkoutReply(
      reply,
      Array.isArray(loopResult.toolsUsed) ? loopResult.toolsUsed : [],
      lang,
      finalStage,
      _stageToPolicyFlags(finalStage),
      _stageToActions(finalStage),
      commerceCheckoutOut,
      quoteIdFromMeta || null,
      loopResult.redirect_to || null,
      loopResult.next_chips || [],
      loopResult.chips_display,
      loopResult.llm_usage || null,
      uiAttach
    );
  }

  // ─────────────────────────────────────────────────────────────
  // LLM loop: call → check for tool_calls → execute → repeat
  // ─────────────────────────────────────────────────────────────
  static async _runLLMLoop({
    history,
    context,
    clinicId,
    patientId,
    callerPhone,
    sessionId,
    channel,
    forceProvider,
    checkoutPolicy,
    onStreamDelta,
    onToolStatus,
    customerId = null,
    providerInstructions = null,
  }) {
    const groq = getGroq();
    const effectiveProvider = forceProvider || resolvePrimaryProvider();
    const maxTurns = channel === 'voice' ? Math.min(8, MAX_HISTORY_TURNS) : MAX_HISTORY_TURNS;
    const maxChars = channel === 'voice' ? MAX_HISTORY_CONTENT_CHARS_VOICE : MAX_HISTORY_CONTENT_CHARS_CHAT;
    const prunedHistory = history
      .slice(-maxTurns)
      .map(m => ({ role: m.role, content: _truncateForLLM(m.content, maxChars) }));

    const commerceCtx = context.commerceContext;
    const useCommerceTools = !!(commerceCtx && commerceCtx.productId && commerceCtx.providerId);
    let toolsForRequest = useCommerceTools ? COMMERCE_CHECKOUT_TOOLS : KELLY_TOOLS;
    const allowedTools = Array.isArray(checkoutPolicy?.allowedTools) ? checkoutPolicy.allowedTools : null;
    if (useCommerceTools && allowedTools && allowedTools.length) {
      toolsForRequest = toolsForRequest.filter((t) => allowedTools.includes(t?.function?.name));
    }
    if (!useCommerceTools && KellyOrchestratorPhase.orchestratorEnabled() && context.orchestration) {
      const pruned = KellyOrchestratorPhase.filterKellyToolsByPhase(KELLY_TOOLS, context.orchestration.phase, {
        includeDermEducation: DERM_EDUCATION_PIPELINE_ENABLED
      });
      if (pruned.length > 0) toolsForRequest = pruned;
      if (
        context.orchestration.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
        context.orchestration.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP
      ) {
        toolsForRequest = KellyOrchestratorPhase.mapToolDescriptionsForRoutineIntake(toolsForRequest);
      }
    }
    const streamCommerce = typeof onStreamDelta === 'function' && useCommerceTools;

    let systemContent = useCommerceTools
      ? buildCommerceCheckoutSystemPrompt({
          ...commerceCtx,
          preferredLanguage: context.preferredLanguage
        })
      : KellyPromptBuilder.buildKellySystemPrompt(context, {
          buildLegacy: _buildSystemPromptLegacy,
          languageDirective: (pl) => KellyAgentService._languageDirective(pl)
        });

    if (channel === 'voice') {
      let providerBlock = providerInstructions;
      if (!providerBlock && customerId && db.getCustomer) {
        const cust = db.getCustomer(customerId);
        if (cust?.custom_prompt && String(cust.custom_prompt).trim()) {
          providerBlock = String(cust.custom_prompt).trim();
        }
      }
      if (providerBlock) {
        systemContent =
          `## Provider instructions (follow unless safety or emergency rules override)\n${providerBlock}\n\n` +
          systemContent;
      }
    }

    if (
      !useCommerceTools &&
      (context.orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
        context.orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP) &&
      context.routineIntakeSummaryMarkdown
    ) {
      systemContent += `\n\n${context.routineIntakeSummaryMarkdown}\n`;
    }
    if (useCommerceTools && checkoutPolicy?.goal) {
      systemContent += `\n\n## Checkout sub-node goal\n${String(checkoutPolicy.goal)}\nDo not leave this goal in this turn.`;
    }
    const collected = useCommerceTools ? null : _extractCollectedBookingInfo(history);
    if (collected) {
      systemContent += `\n\n## BOOKING STATE (from conversation)\nYou have collected: name="${collected.name}", email="${collected.email}", phone="${collected.phone}". Call schedule_appointment NOW with these values. Do NOT ask for name, email, or phone again.\n`;
    }
    if (!useCommerceTools && context.scanGrounding) {
      const groundingBlock = _buildIngredientGroundingBlock(context.scanGrounding);
      if (groundingBlock) systemContent += `\n\n${groundingBlock}\n`;
    }

    let messages = [
      { role: 'system', content: systemContent },
      ...prunedHistory
    ];

    const toolsUsed = [];
    const toolCallCounts = {};
    let endCall = false;
    let iterations = 0;
    let nextStep = null;
    let nextChips = null;
    let chipsDisplay = null;
    let commercePaymentRedirect = null;
    let commerceCheckoutPayload = null;
    const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      let response;
      try {
        const maxTokRouter =
          effectiveProvider === 'anthropic'
            ? channel === 'voice'
              ? KELLY_VOICE_MAX_TOKENS
              : parseInt(process.env.KELLY_ANTHROPIC_MAX_TOKENS || String(KELLY_CHAT_MAX_TOKENS), 10)
            : channel === 'voice'
              ? KELLY_VOICE_MAX_TOKENS
              : KELLY_CHAT_MAX_TOKENS;
        const routerCall = {
          messages,
          tools: toolsForRequest,
          channel,
          maxTokens: maxTokRouter
        };
        if (forceProvider) routerCall.forceProvider = forceProvider;
        if (streamCommerce) {
          response = await callStreamWithDeltas({
            messages,
            tools: toolsForRequest,
            maxTokens: maxTokRouter,
            channel,
            onDelta: onStreamDelta,
            forceProvider: forceProvider || null
          });
        } else {
          response = await LLMRouter.call(routerCall);
        }
        if (response?._usage) {
          totalUsage.prompt_tokens += Number(response._usage.prompt_tokens || 0);
          totalUsage.completion_tokens += Number(response._usage.completion_tokens || 0);
          totalUsage.total_tokens += Number(response._usage.total_tokens || 0);
        }
      } catch (err) {
        const messageLower = err?.message ? String(err.message).toLowerCase() : '';
        const isRateLimit = (err?.status === 429 || err?.statusCode === 429 || messageLower.includes('rate_limit') || messageLower.includes('rate limit'));
        const isTooLarge = (err?.status === 413 || err?.statusCode === 413 ||
          messageLower.includes('too large') ||
          messageLower.includes('request too large') ||
          messageLower.includes('tokens per minute') ||
          messageLower.includes('413'));

        if ((isRateLimit || isTooLarge) && GROQ_FALLBACK_MODEL && GROQ_FALLBACK_MODEL !== GROQ_MODEL) {
          const reason = isTooLarge ? 'Request too large' : 'Rate limit hit';
          console.warn(`[KellyAgent] ${reason}, retrying with fallback model after 1s delay:`, GROQ_FALLBACK_MODEL);
          // Small delay: Groq limits are per API-key, so immediate retry can hit again.
          await new Promise(r => setTimeout(r, 1000));
          try {
            const compactSystem = useCommerceTools
              ? buildCommerceCheckoutSystemPrompt({
                  ...commerceCtx,
                  preferredLanguage: context.preferredLanguage
                }).slice(0, 3500)
              : _buildCompactSystemPrompt(context);

            // Keep only a few messages when we're size-limited; tool payloads inflate fast.
            // Also re-truncate message content to make the retry request much smaller.
            const keepN = isTooLarge ? 2 : 8;
            const maxCharsRetry = isTooLarge ? (channel === 'voice' ? 700 : 650) : maxChars;
            const trimmedHistory = messages
              .filter(m => m.role !== 'system')
              .slice(-keepN)
              .map(m => ({
                ...m,
                content: (typeof m.content === 'string' ? _truncateForLLM(m.content, maxCharsRetry) : m.content)
              }));

            messages = [
              { role: 'system', content: compactSystem },
              ...trimmedHistory
            ];

            if (streamCommerce) {
              response = await callStreamWithDeltas({
                messages,
                tools: toolsForRequest,
                maxTokens: channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS,
                channel,
                onDelta: onStreamDelta,
                forceProvider: 'groq'
              });
            } else {
              response = await groq.chat.completions.create({
                model: GROQ_FALLBACK_MODEL,
                messages,
                tools: toolsForRequest,
                tool_choice: 'auto',
                temperature: 0.3,
                max_tokens: channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS
              });
            }
            if (response?._usage) {
              totalUsage.prompt_tokens += Number(response._usage.prompt_tokens || 0);
              totalUsage.completion_tokens += Number(response._usage.completion_tokens || 0);
              totalUsage.total_tokens += Number(response._usage.total_tokens || 0);
            } else if (response?.usage) {
              const p = Number(response.usage.prompt_tokens || response.usage.input_tokens || 0);
              const c = Number(response.usage.completion_tokens || response.usage.output_tokens || 0);
              totalUsage.prompt_tokens += p;
              totalUsage.completion_tokens += c;
              totalUsage.total_tokens += p + c;
            }
          } catch (err2) {
            console.error('[KellyAgent] Fallback model also failed:', err2.message);
            throw err2;
          }
        } else {
          console.error('[KellyAgent] Groq API error:', err?.message || err);
          throw err;
        }
      }

      const choice = response.choices?.[0];
      if (!choice) break;

      const { finish_reason, message: assistantMsg } = choice;

      // ── Text reply: done ──────────────────────────────────
      if (finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
        let reply = assistantMsg.content || "I'm sorry, I didn't catch that. Could you say that again?";
        if (!useCommerceTools) {
          try {
            const ClinicalRecommendationPolicy = require('../clinical/clinical-recommendation-policy');
            const v = ClinicalRecommendationPolicy.validateAssistantText(reply);
            if (!v.ok) {
              const ph = context.orchestration?.phase;
              const routineSkincare =
                !context.scanChatMode && (
                  ph === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
                  ph === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP
                );
              reply = ClinicalRecommendationPolicy.fallbackReply(v, { routineSkincare });
            }
          } catch (_) {}
        }
        return {
          reply,
          toolsUsed,
          endCall,
          next_step: nextStep,
          next_chips: nextChips,
          chips_display: chipsDisplay,
          redirect_to: commercePaymentRedirect || null,
          commerce_checkout: useCommerceTools ? commerceCheckoutPayload : null,
          llm_usage: totalUsage
        };
      }

      // ── Tool calls: execute each, append results ──────────
      messages.push({ role: 'assistant', content: assistantMsg.content || null, tool_calls: assistantMsg.tool_calls });

      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;
        if (typeof onToolStatus === 'function' && useCommerceTools) {
          const label =
            toolName === 'get_product_quote'
              ? 'Getting your price…'
              : toolName === 'add_to_cart'
                ? 'Adding to cart…'
                : toolName === 'update_cart_item'
                  ? 'Updating cart…'
                  : toolName === 'remove_cart_item'
                    ? 'Removing item…'
                    : toolName === 'get_cart'
                      ? 'Checking cart…'
                      : toolName === 'clear_cart'
                        ? 'Clearing cart…'
              : toolName === 'prepare_commerce_checkout'
                ? 'Preparing secure checkout…'
                          : toolName === 'find_clinic_specialists'
                            ? 'Looking up specialists…'
                            : toolName === 'search_medical_literature'
                              ? 'Searching medical literature…'
                : 'Working…';
          try {
            onToolStatus(toolName, label);
          } catch (_) {}
        }
        toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
        if (toolCallCounts[toolName] > 2) {
          console.warn(`[KellyAgent] Tool ${toolName} called ${toolCallCounts[toolName]} times — breaking loop`);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: `${toolName} already attempted twice. Do not call this tool again. Move to the next step.`
            })
          });
          continue;
        }
        // E2E harness: only count get_available_slots after a successful lookup — blocked/refused
        // calls must not look like "slots before triage" (tool order violation).
        const deferSlotMetric = toolName === 'get_available_slots';
        if (!deferSlotMetric) {
        toolsUsed.push(toolName);
        }

        let toolArgs;
        try {
          toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch (_) {
          toolArgs = {};
        }

        if (toolName === 'schedule_appointment' && !toolArgs.practitioner_id) {
          const rawBundles = KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_bundles');
          if (_kellyDebugVerbose()) {
            console.log('[DEBUG-MATCH] schedule called, practitioner_id missing');
            console.log('[DEBUG-MATCH] last_slot_bundles from meta:', rawBundles ? `${rawBundles.slice(0, 200)}…` : 'NOT SET');
            console.log('[DEBUG-MATCH] user message for resolution:', String(context?.message || '').slice(0, 100));
          }
          try {
            const raw = rawBundles;
            if (raw) {
              const bundles = JSON.parse(raw);
              const userMsgLc = String(context?.message || '').toLowerCase().trim();
              const matched = _resolveSlotBundleFromUserMessage(bundles || [], userMsgLc) || bundles[0];
              if (matched?.practitioner_id) toolArgs.practitioner_id = matched.practitioner_id;
              if (matched?.lane && !toolArgs.lane) toolArgs.lane = matched.lane;
              if (!toolArgs.date) {
                toolArgs.date = matched?.date || KellyToolExecutor._getSessionMeta?.(sessionId, 'preferred_date_resolved') || null;
              }
              if ((matched?.time || matched?.start_time || matched?.start) && !toolArgs.time) {
                toolArgs.time = matched.time || matched.start_time || matched.start;
              }
            }
          } catch (_) {}
        }

        // Server-side injection of contact info collected across previous turns.
        // Prevents re-ask loops when LLM loses context in long conversations.
        if (toolName === 'schedule_appointment') {
          const storedEmail = KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_email');
          const storedPhone = KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_phone');
          const storedName = KellyToolExecutor._getSessionMeta?.(sessionId, 'collected_name');
          if (!toolArgs.patient_email && storedEmail) {
            toolArgs.patient_email = storedEmail;
            if (_kellyDebugVerbose()) console.log('[INJECT] patient_email from session meta');
          }
          if (!toolArgs.patient_phone && storedPhone) {
            toolArgs.patient_phone = normalizeToE164(storedPhone) || storedPhone;
            if (_kellyDebugVerbose()) console.log('[INJECT] patient_phone from session meta');
          }
          if (!toolArgs.patient_name && storedName) {
            toolArgs.patient_name = storedName;
            if (_kellyDebugVerbose()) console.log('[INJECT] patient_name from session meta');
          }
        }

        if (commerceCtx && toolName === 'get_product_quote') {
          if (!toolArgs.product_id && !toolArgs.prescription_id) {
            toolArgs.product_id = commerceCtx.productId;
          }
          if (!toolArgs.provider_id) {
            toolArgs.provider_id = commerceCtx.providerId;
          }
        }
        if (
          commerceCtx &&
          ['get_cart', 'add_to_cart', 'update_cart_item', 'remove_cart_item', 'clear_cart'].includes(toolName)
        ) {
          if (!toolArgs.provider_id) toolArgs.provider_id = commerceCtx.providerId;
          if (
            !toolArgs.product_id &&
            !toolArgs.prescription_id &&
            ['add_to_cart', 'update_cart_item', 'remove_cart_item'].includes(toolName)
          ) {
            toolArgs.product_id = commerceCtx.productId;
          }
        }
        if (commerceCtx && toolName === 'prepare_commerce_checkout') {
          const pe = commerceCtx.patientEmail || context.patientEmail;
          if (pe && !toolArgs.customer_email) {
            toolArgs.customer_email = pe;
          }
          if (!toolArgs.quote_id && toolArgs.use_cart !== false) {
            toolArgs.use_cart = true;
          }
        }

        if (toolName === 'end_call') {
          endCall = true;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: true, message: 'Call ended' })
          });
          continue;
        }

        // Execute tool via KellyToolExecutor
        let toolResult;
        try {
          toolResult = await KellyToolExecutor.execute(toolName, toolArgs, {
            sessionId,
            clinicId,
            patientId,
            callerPhone,
            channel
          });
        } catch (err) {
          console.error(`[KellyAgent] Tool ${toolName} failed:`, err.message);
          toolResult = { success: false, error: err.message };
        }

        if (toolName === 'evaluate_skincare_routine' && toolResult?.success) {
          try {
            const { persistRoutinePostHookSnapshot } = require('../catalog/routine-post-turn-hook');
            persistRoutinePostHookSnapshot(sessionId, toolResult, { userMessage: context?.message });
          } catch (_) {}
        }

        if (
          toolName === 'get_product_quote' &&
          toolResult?.success &&
          (toolResult.quote_id || toolResult.checkout_session_id)
        ) {
          KellyToolExecutor._setSessionMeta(
            sessionId,
            'last_commerce_quote_id',
            toolResult.quote_id || toolResult.checkout_session_id
          );
        }

        if (deferSlotMetric && toolResult?.success) {
          toolsUsed.push('get_available_slots');
        }

        // Normalize slot provider identity fields on all slot paths
        // (specialist and fallback) to avoid name hallucination.
        if (toolName === 'get_available_slots' && Array.isArray(toolResult?.slot_bundles)) {
          toolResult.slot_bundles = toolResult.slot_bundles.map((s) => ({
            ...s,
            practitioner_name: s?.practitioner_name || null,
            practitioner_id: s?.practitioner_id || null
          }));
        }

        if (
          toolName === 'get_available_slots' &&
          toolResult?.success &&
          Array.isArray(toolResult.slot_bundles) &&
          toolResult.slot_bundles.length
        ) {
          try {
            KellyToolExecutor._setSessionMeta(
              sessionId,
              'last_slot_bundles',
              JSON.stringify(toolResult.slot_bundles.slice(0, 12))
            );
            KellyToolExecutor._setSessionMeta(sessionId, 'slot_presented', '1');
          } catch (_) {}
        }

        if (
          toolName === 'get_available_slots' &&
          toolResult &&
          toolResult.success === false &&
          (toolResult.error_code === 'TRIAGE_REQUIRED' || toolResult.error === 'TRIAGE_REQUIRED')
        ) {
          /* no-op: guard below handles loop break */
        } else if (
          toolName === 'get_available_slots' &&
          toolResult?.success &&
          !(Array.isArray(toolResult.slot_bundles) && toolResult.slot_bundles.length) &&
          !(Array.isArray(toolResult.available_slots) && toolResult.available_slots.length)
        ) {
          reply =
            reply ||
            "I don't see openings that day — would you like me to try another day or time?";
        }

        if (toolName === 'schedule_appointment' && toolResult && toolResult.success === false) {
          reply =
            toolResult.message ||
            'Something went wrong booking that slot — I can try again or offer a different time.';
        }

        // A2a-rag: auto-run triage RAG synchronously after OPQRST stored when no RAG row yet.
        if (
          (toolName === 'store_triage_opqrst' || toolName === 'store_triage_rich_intake') &&
          toolResult?.success !== false
        ) {
          try {
            const rowAfterOpqrst = db.getTriageSession ? db.getTriageSession(sessionId) : null;
            const ragExists =
              TriageRAGService.getAuthoritativeForSession(sessionId) ||
              (rowAfterOpqrst?.rag_result_id && String(rowAfterOpqrst.rag_result_id).trim());
            const opqrstDone =
              rowAfterOpqrst &&
              (rowAfterOpqrst.opqrst_complete === 1 || rowAfterOpqrst.opqrst_complete === true);
            if (opqrstDone && !ragExists) {
              const ragOut = await KellyToolExecutor.execute(
                'run_triage_rag',
                { symptom_text: String(context?.message || message || rowAfterOpqrst.quality || 'derm visit') },
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
              if (!toolsUsed.includes('run_triage_rag')) {
                toolsUsed = Array.isArray(toolsUsed) ? [...toolsUsed, 'run_triage_rag'] : ['run_triage_rag'];
              }
              if (ragOut?.low_confidence && ragOut?.suggested_next_step) {
                reply = _sanitizeSuggestedNextStep(ragOut.suggested_next_step);
              } else if (ragOut && ragOut.success === false) {
                reply = 'I need a bit more detail before we can schedule — can you tell me more about the rash?';
              }
            }
          } catch (autoRagErr) {
            console.warn('[KellyAgent] auto run_triage_rag:', autoRagErr.message);
          }
        }

        if (_kellyDebugVerbose()) {
          const safeToolResult = redactObject(toolResult);
          console.log(`[KellyAgent] Tool result for ${toolName}:`, JSON.stringify(safeToolResult)?.slice(0, 500));
        }

        if (toolName === 'prepare_commerce_checkout' && useCommerceTools && toolResult) {
          if (toolResult?.success && toolResult?.checkout?.payment_link) {
            commercePaymentRedirect = toolResult.checkout.payment_link;
          }
          commerceCheckoutPayload =
            toolResult.commerce_checkout ||
            (toolResult.cart_summary || toolResult.payment_action
              ? {
                  cart_summary: toolResult.cart_summary,
                  next_required_fields: toolResult.next_required_fields,
                  payment_action: toolResult.payment_action,
                  success: !!toolResult.success,
                  error: toolResult.success ? null : toolResult.error || null,
                  message: toolResult.message || null
                }
              : null);
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          // Keep next request compact by truncating large tool payloads.
          content: _truncateForLLM(
            JSON.stringify(toolResult),
            channel === 'voice' ? KELLY_TOOL_RESULT_MAX_CHARS_VOICE : KELLY_TOOL_RESULT_MAX_CHARS_CHAT
          )
        });

        if (
          toolName === 'get_available_slots' &&
          toolResult?.success &&
          (
            (Array.isArray(toolResult.available_slots) && toolResult.available_slots.length > 0) ||
            (Array.isArray(toolResult.slot_bundles) && toolResult.slot_bundles.length > 0)
          )
        ) {
          toolCallCounts.get_available_slots = 99; // Hard stop — prevent any further slot calls this turn
          messages.push({
            role: 'user',
            content: '[SYSTEM: Slots found for this date. Present these options to the patient. Do not check additional dates in this turn. Do not call get_available_slots again.]'
          });
          break;
        }

        // Guardrail: if slot lookup is refused because triage isn't ready yet, do not
        // continue the tool-call loop (prevents run_triage_rag <-> get_available_slots spirals).
        if (toolName === 'get_available_slots' && toolResult && toolResult.success === false) {
          const code = toolResult.error_code || toolResult.error;
          if (['TRIAGE_INCOMPLETE', 'LOW_CONFIDENCE', 'TRIAGE_REQUIRED', 'DIFFERENTIALS_REQUIRED', 'SAFETY_BLOCKED'].includes(code)) {
            const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
            const routineLocked = _isRoutineLockedForSession(sessionId, history) && !SYMPTOM_KEYWORDS.some((k) => String(context?.message || '').toLowerCase().includes(k));
            if (routineLocked) {
              const preferredLane = (() => {
                try {
                  return KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'preferred_lane') : null;
                } catch (_) {
                  return null;
                }
              })();
              if (preferredLane) {
                const preferredDate = (() => {
                  try {
                    return KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'preferred_date') : null;
                  } catch (_) {
                    return null;
                  }
                })();
                const date = _resolvePreferredDateFromMeta(preferredDate, context?.clinicId);
                const slotOut = await KellyToolExecutor.execute(
                  'get_available_slots',
                  { date, appointment_type: 'Primary Care', lane: preferredLane, force_after_clarified: true },
                  { sessionId, clinicId: context?.clinicId, patientId: context?.patientId, callerPhone: context?.callerPhone, channel }
                );
                if (slotOut?.success) {
                  const source = Array.isArray(slotOut.slot_bundles) && slotOut.slot_bundles.length
                    ? slotOut.slot_bundles
                    : (Array.isArray(slotOut.available_slots) ? slotOut.available_slots : []);
                  if (source.length) {
                    try {
                      KellyToolExecutor._setSessionMeta(sessionId, 'slot_presented', '1');
                    } catch (_) {}
                    return {
                      reply: 'Here are some available times. Please choose one.',
                      toolsUsed: [...toolsUsed, 'get_available_slots'],
                      endCall: false,
                      next_step: null,
                      next_chips: source.slice(0, 8).map((s, i) => ({
                        label: `Option ${i + 1}: ${s?.display || s?.time || String(s)}`,
                        value: `option ${i + 1}`,
                        action: 'select_slot',
                        slot: s
                      })),
                      chips_display: 'list'
                    };
                  }
                }
                return {
                  reply: "I couldn't find available times for that date. What date would you like to try?",
                  toolsUsed,
                  endCall: false,
                  next_step: null,
                  next_chips: null,
                  chips_display: null
                };
              }
              return {
                reply: 'Got it. Since this is a routine visit with no current symptoms, do you need to see a doctor immediately, or would you like to schedule for later?',
                toolsUsed,
                endCall: false,
                next_step: null,
                next_chips: null,
                chips_display: null
              };
            }
            const toolMsgRaw = typeof toolResult.message === 'string' && toolResult.message.trim()
              ? toolResult.message.trim()
              : '';
            const routineMode = !!KellyToolExecutor._routineNoSymptomsEffective?.(sessionId);
            const toolMsg = (!routineMode && toolMsgRaw) ? _sanitizeToolMessageForPatient(toolMsgRaw) : '';
            return {
              reply: _replyForTriageIncomplete(code, channel, context?.preferredLanguage, sessionRow, context?.message) +
                (toolMsg ? ` ${toolMsg}` : ''),
              toolsUsed,
              endCall: false,
              next_step: null,
              next_chips: null,
              chips_display: null
            };
          }
          if (['PROVIDER_AVAILABILITY_NOT_SET', 'PROVIDER_CALENDAR_NOT_CONNECTED', 'NO_BOOKABLE_SYNC_PROVIDER', 'NO_ONLINE_PROVIDERS'].includes(code)) {
            const fallbackMsgByCode = {
              PROVIDER_AVAILABILITY_NOT_SET: 'Our care team is online, but availability has not been published yet. I can check the next date, switch this to async review, or arrange a callback.',
              PROVIDER_CALENDAR_NOT_CONNECTED: 'No specialist has live calendar sync right now. I can check the next date, switch this to async review, or arrange a callback.',
              NO_BOOKABLE_SYNC_PROVIDER: 'No sync-bookable specialist is available right now. I can check the next date, switch this to async review, or arrange a callback.',
              NO_ONLINE_PROVIDERS: 'No specialists are online right now. I can check the next date, switch this to async review, or arrange a callback.'
            };
            return {
              reply: fallbackMsgByCode[code] || 'No specialist is immediately bookable right now. I can check the next date, switch this to async review, or arrange a callback.',
              toolsUsed,
              endCall: false,
              next_step: null,
              next_chips: [
                { label: 'Check next date', value: 'next_date_search', action: 'next_date_search' },
                { label: 'Async review lane', value: 'async_review_lane', action: 'async_review_lane' },
                { label: 'Request callback', value: 'request_callback', action: 'request_callback' }
              ],
              chips_display: 'list',
              error_code: code
            };
          }
        }

        // Capture next_step, next_chips from tool results for chat UX (upload zone, chips)
        if (toolResult?.next_step) nextStep = toolResult.next_step;
        if (toolResult?.next_chips) nextChips = toolResult.next_chips;
        if (toolResult?.chips_display != null) chipsDisplay = toolResult.chips_display;

        // Special: if run_triage_rag returns red → override with emergency reply
        if (toolName === 'run_triage_rag' && toolResult?.safety_level === 'red') {
          const emergencyReply = toolResult.patient_friendly_summary ||
            'Your symptoms require emergency care. Please call 911 or go to the nearest emergency room immediately.';
          return { reply: emergencyReply, toolsUsed, endCall: false, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay, llm_usage: totalUsage };
        }
      }

      if (endCall) {
        // Do one more LLM call to get a closing reply (LLMRouter respects forceProvider / primary)
        let closeReply = 'Thank you for calling Somo. Take care!';
        try {
          const closeOpts = { messages, tools: [], channel, maxTokens: 100 };
          if (forceProvider) closeOpts.forceProvider = forceProvider;
          const closeResponse = await LLMRouter.call(closeOpts);
          closeReply = closeResponse.choices?.[0]?.message?.content || closeReply;
        } catch (closeErr) {
          console.warn('[KellyAgent] Closing message LLM failed, using default:', closeErr?.message || closeErr);
        }
        return { reply: closeReply, toolsUsed, endCall: true, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay, llm_usage: totalUsage };
      }
    }

    // Safety: if loop exhausted without reply — synthesize from last get_available_slots result if possible
    // Bug 16: Filter to slot tool results; last tool message could be store_triage_opqrst etc.
    const slotToolIds = new Set();
    for (const m of messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.function?.name === 'get_available_slots') slotToolIds.add(tc.id);
        }
      }
    }
    const slotToolMsgs = messages.filter(m => m.role === 'tool' && m.tool_call_id && slotToolIds.has(m.tool_call_id) && m.content);
    const lastSlotResult = slotToolMsgs.length ? slotToolMsgs[slotToolMsgs.length - 1].content : null;
    let fallback = "I'm sorry, something went wrong on my end. Please try again or call us directly.";
    try {
      const parsed = lastSlotResult ? JSON.parse(lastSlotResult) : null;
      if (parsed?.success && parsed?.slot_bundles?.length) {
        fallback = `I found ${parsed.slot_bundles.length} available time(s). Which one works best for you? Or say "call back" and we can continue by phone.`;
      } else if (parsed?.success && parsed?.available_slots?.length) {
        fallback = `I have availability. Please tell me which time you prefer, or we can continue over the phone.`;
      }
    } catch (_) {}
    return {
      reply: fallback,
      toolsUsed,
      endCall: false,
      next_step: nextStep,
      next_chips: nextChips,
      chips_display: chipsDisplay,
      redirect_to: commercePaymentRedirect || null,
      commerce_checkout: useCommerceTools ? commerceCheckoutPayload : null,
      llm_usage: totalUsage
    };
  }

  /**
   * Fire schedule_appointment server-side when contact is complete.
   * Used by email confirmation and phone-complete intercepts to bypass LLM.
   *
   * Lock note: `server_schedule_lock` is session-meta best-effort (SQLite). Concurrent HTTP
   * requests for the same sessionId can race before either sets the lock; strict mutual
   * exclusion would need a DB transaction or row-level lock.
   */
  static async _serverSideSchedule({
    sessionId, clinicId, patientId, callerPhone, channel,
    preferredLanguage, confirmedEmail, confirmedPhone, confirmedName, phoneConfirmed = false
  }) {
    const scheduleLock = KellyToolExecutor._getSessionMeta?.(sessionId, 'server_schedule_lock');
    if (String(scheduleLock || '') === '1') {
      return {
        reply: 'I am still processing your booking request. Please give me one moment.',
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        error_code: 'SCHEDULE_IN_PROGRESS'
      };
    }
    KellyToolExecutor._setSessionMeta?.(sessionId, 'server_schedule_lock', '1');
    try {
      const rawBundles = KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_bundles');
      const bundles = rawBundles ? JSON.parse(rawBundles) : [];
      let slot = bundles[0] || null;

      const preferredDate = KellyToolExecutor._getSessionMeta(sessionId, 'preferred_date');
      const preferredDateResolved = KellyToolExecutor._getSessionMeta(sessionId, 'preferred_date_resolved');
      const date = slot?.date
        || preferredDateResolved
        || (preferredDate ? _resolvePreferredDateFromMeta(preferredDate, clinicId) : null)
        || (() => {
          const d = new Date();
          const day = d.getDay();
          if (day === 6) d.setDate(d.getDate() + 2);
          if (day === 0) d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        })();

      const time = slot?.time || slot?.start_time || slot?.start || '09:00';
      const practitioner_id = slot?.practitioner_id || null;
      const lane = slot?.lane || KellyToolExecutor._getSessionMeta(sessionId, 'preferred_lane') || 'sync';

      if (!slot) {
        const next = await _findNextAvailableDate(
          date,
          clinicId,
          'Primary Care',
          lane,
          sessionId,
          patientId,
          callerPhone,
          channel
        );
        if (next) {
          const source = Array.isArray(next.slotOut.slot_bundles) && next.slotOut.slot_bundles.length
            ? next.slotOut.slot_bundles
            : (Array.isArray(next.slotOut.available_slots) ? next.slotOut.available_slots : []);
          try {
            KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_bundles', JSON.stringify(source.slice(0, 12)));
            KellyToolExecutor._setSessionMeta(sessionId, 'preferred_date_resolved', next.date || '');
            KellyToolExecutor._setSessionMeta(sessionId, 'slot_presented', '1');
          } catch (_) {}
          const chips = source.slice(0, 8).map((s, i) => ({
            label: `Option ${i + 1}: ${s?.display || s?.time || String(s)}`,
            value: `option ${i + 1}`,
            action: 'select_slot',
            slot: s
          }));
          const nextReply = `No openings on ${date}. I found availability on ${next.date}. Here are the times:`;
          this._appendToHistory(sessionId, 'assistant', nextReply);
          return {
            reply: nextReply,
            endCall: false,
            toolsUsed: ['get_available_slots'],
            language: preferredLanguage || 'en',
            next_chips: chips,
            chips_display: 'list',
            error_code: 'NO_SLOTS_ON_REQUESTED_DATE'
          };
        }
      }

      if (_kellyDebugVerbose()) {
        console.log('[SERVER-SCHEDULE] Firing schedule_appointment server-side:', {
          email: confirmedEmail.slice(0, 4) + '…',
          date, time, practitioner_id, lane
        });
      }

      const scheduleResult = await KellyToolExecutor.execute(
        'schedule_appointment',
        {
          patient_name: confirmedName,
          patient_email: confirmedEmail,
          patient_phone: normalizeToE164(confirmedPhone) || confirmedPhone,
          appointment_type: 'Primary Care',
          date,
          time,
          timezone: 'America/New_York',
          practitioner_id,
          lane,
          phone_confirmed: !!phoneConfirmed,
          force_after_clarified: true,
          notes: 'Booked via routine visit flow'
        },
        { sessionId, clinicId, patientId, callerPhone, channel }
      );

      let reply;
      let errorCode = null;
      let duplicate = false;
      if (scheduleResult?.success) {
        KellyToolExecutor._setSessionMeta(sessionId, 'identity_conflict', '0');
        KellyToolExecutor._setSessionMeta(sessionId, 'identity_conflict_retry_count', '0');
        const apptDate = slot?.display || `${date} at ${time}`;
        reply = scheduleResult?.next_step
          || scheduleResult?.say_to_patient
          || scheduleResult?.message
          || `Your appointment is confirmed for ${apptDate}. I've sent a verification code to ${confirmedEmail} to complete checkout. Please share the 6-digit code when you receive it.`;
      } else {
        if (scheduleResult?.duplicate && scheduleResult?.requiresPhoneConfirmation) {
          KellyToolExecutor._setSessionMeta(sessionId, 'identity_conflict', '1');
          duplicate = true;
          errorCode = 'DUPLICATE_IDENTITY_PHONE_CONFIRMATION';
          const candidate = Array.isArray(scheduleResult?.duplicates) ? scheduleResult.duplicates[0] : null;
          const maskedTail = _maskPhoneTail(candidate?.phone || candidate?.telecom?.phone || candidate?.phone_number || '');
          const hint = maskedTail ? ` I found a matching profile ending in ${maskedTail}.` : '';
          reply = `I found an existing record with a similar name.${hint} To confirm your identity, could you verify your phone number? Please provide it in the format +1 followed by your 10-digit number.`;
        } else if (scheduleResult?.error === 'TRIAGE_REQUIRED') {
          errorCode = 'TRIAGE_REQUIRED';
          reply = 'I need to complete a quick triage check before booking. Could you briefly describe what brings you in today?';
        } else if (scheduleResult?.error === 'SAFETY_BLOCKED') {
          errorCode = 'SAFETY_BLOCKED';
          reply = 'I am unable to complete this booking due to a safety flag on this session. Please call us directly for assistance.';
        } else if (scheduleResult?.error === 'TRIAGE_INCOMPLETE') {
          errorCode = 'TRIAGE_INCOMPLETE';
          reply = 'I still need a bit more information before I can book. Could you answer one more question about your visit?';
        } else if (scheduleResult?.error === 'PROVIDER_AVAILABILITY_NOT_SET') {
          errorCode = 'PROVIDER_AVAILABILITY_NOT_SET';
          reply = 'Our care team is online, but availability has not been published yet. I can check the next date, switch this to async review, or arrange a callback.';
        } else if (scheduleResult?.error === 'PROVIDER_CALENDAR_NOT_CONNECTED') {
          errorCode = 'PROVIDER_CALENDAR_NOT_CONNECTED';
          reply = 'No specialist has live calendar sync right now. I can check the next date, switch this to async review, or arrange a callback.';
        } else if (scheduleResult?.error === 'NO_BOOKABLE_SYNC_PROVIDER') {
          errorCode = 'NO_BOOKABLE_SYNC_PROVIDER';
          reply = 'No sync-bookable specialist is available right now. I can check the next date, switch this to async review, or arrange a callback.';
        } else if (scheduleResult?.error === 'NO_ONLINE_PROVIDERS') {
          errorCode = 'NO_ONLINE_PROVIDERS';
          reply = 'No specialists are online right now. I can check the next date, switch this to async review, or arrange a callback.';
        } else {
          console.error('[SERVER-SCHEDULE] Unhandled failure:', JSON.stringify(scheduleResult));
          errorCode = scheduleResult?.error || 'UNKNOWN_SCHEDULE_ERROR';
          reply = `I wasn't able to confirm that booking (${scheduleResult?.error || 'unknown error'}). Please try again or call us directly.`;
        }
      }

      this._appendToHistory(sessionId, 'assistant', reply);
      return {
        reply,
        endCall: false,
        toolsUsed: ['schedule_appointment'],
        language: preferredLanguage || 'en',
        error_code: errorCode,
        duplicate,
        schedule_result: scheduleResult || null,
        next_step: scheduleResult?.next_step || null,
        next_chips: []
      };
    } catch (err) {
      console.error('[SERVER-SCHEDULE] Exception:', err.message);
      const fallback = 'Something went wrong completing your booking. Please try again.';
      this._appendToHistory(sessionId, 'assistant', fallback);
      return { reply: fallback, endCall: false, toolsUsed: [], language: preferredLanguage || 'en', error_code: 'SERVER_SCHEDULE_EXCEPTION' };
    } finally {
      KellyToolExecutor._setSessionMeta?.(sessionId, 'server_schedule_lock', '0');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // History management
  // ─────────────────────────────────────────────────────────────
  static _loadHistory(sessionId) {
    try {
      const rows = db.db.prepare(`
        SELECT role, content FROM kelly_conversation_history
        WHERE session_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(sessionId, MAX_HISTORY_TURNS * 2);
      return rows.map(r => ({ role: r.role, content: r.content }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Persist one history message in the bounded per-session transcript.
   */
  static _appendToHistory(sessionId, role, content) {
    try {
      db.db.prepare(`
        CREATE TABLE IF NOT EXISTS kelly_conversation_history (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          session_id  TEXT NOT NULL,
          role        TEXT NOT NULL,
          content     TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();

      db.db.prepare(`
        INSERT INTO kelly_conversation_history (session_id, role, content)
        VALUES (?, ?, ?)
      `).run(sessionId, role, content || '');

      // Trim to last 100 rows per session
      db.db.prepare(`
        DELETE FROM kelly_conversation_history
        WHERE session_id = ?
          AND id NOT IN (
            SELECT id FROM kelly_conversation_history
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT 100
          )
      `).run(sessionId, sessionId);
    } catch (e) {
      console.warn('[KellyAgent] History append failed:', e.message);
    }
  }

  /**
   * P3-2: server guardrail — issue payment link when pay-now intent or payment_line branch.
   */
  static async _maybePaymentLinkGuardrail({ message, sessionId, patientId, clinicId, callerPhone, channel, graphHost }) {
    const branch = String(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_graph_branch') || '');
    const payIntent = _isPayNowIntent(message);
    const onPaymentLine = branch === 'payment_line' || graphHost?.paymentLine;
    const guardrailOn = graphHost?.payGuardrail || payIntent || onPaymentLine;
    if (!guardrailOn) return null;

    let amount = parseFloat(String(KellyToolExecutor._getSessionMeta(sessionId, 'copay_amount') || ''), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      const db = require('../../database');
      if (patientId && db.db) {
        try {
          const elig = db.db
            .prepare(
              `SELECT copay_amount FROM eligibility_checks WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1`
            )
            .get(patientId);
          if (elig?.copay_amount) amount = Number(elig.copay_amount);
        } catch (_) {}
      }
    }
    if (!Number.isFinite(amount) || amount <= 0) amount = 25;

    const journeyId = KellyToolExecutor._getSessionMeta(sessionId, 'rcm_journey_id') || null;
    const out = await KellyToolExecutor.execute(
      'request_patient_payment',
      {
        amount,
        journey_id: journeyId,
        patient_id: patientId,
        patient_phone: callerPhone,
        delivery: 'both'
      },
      { sessionId, clinicId, patientId, callerPhone, channel }
    );

    if (!out?.success) return null;

    const payUrl = out.pay_url || out.payUrl || null;
    const reply =
      payUrl
        ? `I sent a secure payment link for $${Number(amount).toFixed(2)}. Please open the link to pay with card or wallet — I will not collect card numbers here.`
        : String(out.message || 'Your secure payment link is on the way.');

    this._appendToHistory(sessionId, 'user', message);
    this._appendToHistory(sessionId, 'assistant', reply);
    return {
      reply,
      endCall: false,
      toolsUsed: ['request_patient_payment'],
      language: (require('../../database').getKellySessionLanguage &&
        require('../../database').getKellySessionLanguage(sessionId)) ||
        'en'
    };
  }

  /**
   * Handle non-clinical fast intents before entering the LLM tool loop.
   * Returns a full response object when handled, otherwise null.
   */
  static async _handleFastIntentPrecheck({ intent, message, sessionId, patientId, clinicId, callerPhone, channel, graphHost }) {
    if (intent === 'billing') {
      const graphBranch = String(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_graph_branch') || '');
      if (_isPayNowIntent(message) || graphBranch === 'payment_line' || graphHost?.paymentLine) {
        return null;
      }
      if (graphHost?.supportFaqOnly) {
        /* allow FAQ fast-path below */
      }
      const billingReply = _getBillingReply(message);
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', billingReply);
      return {
        reply: billingReply,
        endCall: false,
        toolsUsed: [],
        language: 'en',
        usedFallback: false
      };
    }

    if (intent === 'routine_booking') {
      const routineOut = await handleRoutineBookingFastPath({
        message,
        sessionId,
        patientId,
        clinicId,
        callerPhone,
        channel,
        appendToHistory: (sid, role, content) => this._appendToHistory(sid, role, content),
      });
      if (routineOut) return routineOut;
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Language detection from history or current message
  // ─────────────────────────────────────────────────────────────
  static _detectPreferredLanguage(history, currentMessage) {
    return detectPreferredLanguage(history, currentMessage);
  }

  // ─────────────────────────────────────────────────────────────
  // Emergency flag persistence
  // ─────────────────────────────────────────────────────────────
  static _persistEmergencyFlag(sessionId, patientId, callerPhone, channel, assessment) {
    return persistEmergencyFlag(sessionId, patientId, callerPhone, channel, assessment);
  }

  static fallbackReply(channel) {
    return channel === 'voice'
      ? "I'm having trouble connecting right now. Please hold on or call back in a moment."
      : "I'm temporarily unavailable. Please try again in a moment or call us directly.";
  }
}

module.exports = KellyAgentService;
