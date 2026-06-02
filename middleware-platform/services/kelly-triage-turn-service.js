'use strict';

const db = require('../database');
const Metrics = require('./metrics');
const { adaptIncomingEvent } = require('./channel-adapter');
const { FALLBACK_CLINIC_ID, resolveClinicIdFromRequest } = require('../lib/resolve-clinic-id');

function isUnifiedChannelAdapterEnabled() {
  const v = String(process.env.UNIFIED_CHANNEL_ADAPTER_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isUnifiedChannelAdapterShadowEnabled() {
  const v = String(process.env.UNIFIED_CHANNEL_ADAPTER_SHADOW_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

async function runKellyTriageTurnForHttpRequest(req, { mappedPatientId, email, portalSessionId }) {
  const KellyAgentService = require('./kelly-agent-service');
  const KellyToolExecutor = require('./kelly-tool-executor');
  const { shouldSkipLandingTurnSeq } = require('./landing-turn-seq');
  const extractEmailFromText = (text) => {
    const m = String(text || '').match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    return m ? String(m[0]).toLowerCase() : null;
  };
  const hasUploadSignal = (text) => /\b(upload|image|photo|file|attachment|document|pdf|jpg|png)\b/i.test(String(text || ''));
  const summarizeReplyForReport = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const wantsSkinReport = (text) =>
    /\b(report|summary|skin profile|send (me )?(a )?report|email (me )?(the )?(report|summary)|care summary)\b/i.test(
      String(text || '')
    );
  const buildReportEmailPrompt = (lang) => {
    const code = String(lang || 'en').trim().toLowerCase().split('-')[0];
    const byLang = {
      en: 'If you want the report, please share your email (or type it in chat) so I can send it.',
      fr: 'Si vous voulez le rapport, partagez votre e-mail (ou tapez-le dans le chat) pour que je puisse vous l envoyer.',
      sw: 'Ikiwa unataka ripoti, tafadhali toa barua pepe yako (au iandike kwenye chat) ili niweze kuituma.',
      ru: 'Если вы хотите отчет, укажите ваш e-mail (или напишите его в чате), и я отправлю его.'
    };
    return byLang[code] || byLang.en;
  };
  const tokenize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const jaccard = (a, b) => {
    const sa = new Set(tokenize(a));
    const sb = new Set(tokenize(b));
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    sa.forEach((t) => { if (sb.has(t)) inter++; });
    return inter / (sa.size + sb.size - inter);
  };
  const looksEnglishReply = (text) => {
    const s = String(text || '').trim();
    if (!s) return false;
    if (/[\u0400-\u04FF]/.test(s)) return false;
    if (/[àâçéèêëîïôûùüÿœ]/i.test(s)) return false;
    return /\b(what|how|today|your|you|main|symptom|concern|help|please)\b/i.test(s);
  };
  const translateReplyIfNeeded = async (reply, targetLang) => {
    const target = String(targetLang || '').trim().toLowerCase();
    if (!reply || !target || target === 'en') return reply;
    if (!looksEnglishReply(reply)) return reply;
    if (!process.env.OPENAI_API_KEY) return reply;
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const out = await openai.chat.completions.create({
        model: process.env.VIDEO_TRANSLATION_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Translate the assistant reply into ${target} while preserving meaning and concise style.` },
          { role: 'user', content: String(reply) }
        ],
        temperature: 0.1,
        max_tokens: 220
      });
      return String(out.choices?.[0]?.message?.content || reply).trim() || reply;
    } catch (_) {
      return reply;
    }
  };
  const enforceRouteContractOnChatReply = ({ reply, semanticContract = null, preRoute = false }) => {
    let out = String(reply || '');
    if (!out) return out;
    const forbidden = Array.isArray(semanticContract?.forbidden_vocab) ? semanticContract.forbidden_vocab : [];
    for (const term of forbidden) {
      const safe = String(term || '').trim();
      if (!safe) continue;
      try {
        out = out.replace(new RegExp(`\\b${safe}\\b`, 'ig'), 'route-specific guidance');
      } catch (_) {}
    }
    if (preRoute) {
      out = out.replace(/\b(skincare|skin type|actives?|tone evening|anti[- ]?aging|blemish)\b/gi, 'product');
      if (!/route/i.test(out)) {
        out = `${out} I will keep guidance neutral until route classification is available.`;
      }
    }
    return out;
  };
  // S-1: No last-resort fallback clinic (multi-tenant leak). Use env, request, or patient's clinic only.
  let clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
  if (!clinicId && mappedPatientId && db?.getPatientClinicIds) {
    try {
      const patientClinics = db.getPatientClinicIds(mappedPatientId);
      clinicId = patientClinics?.[0] || null;
    } catch (_) {}
  }
  if (!clinicId) return { status: 400, json: { success: false, error: 'clinic_id required. Set DEFAULT_CLINIC_ID in .env, include clinic_id in request, or ensure patient has appointments.', request_id: req.id } };
  const message = (req.body?.message || '').toString();
  const trimmedMessage = message.trim();
  const MAX_TRIAGE_MESSAGE_LENGTH = 4000;
  if (!trimmedMessage) {
    return { status: 400, json: { success: false, error: 'message is required', request_id: req.id } };
  }
  if (trimmedMessage.length > MAX_TRIAGE_MESSAGE_LENGTH) {
    return {
      status: 400,
      json: {
        success: false,
        error: `message too long (max ${MAX_TRIAGE_MESSAGE_LENGTH} characters)`,
        code: 'TRIAGE_MESSAGE_TOO_LONG',
        request_id: req.id
      }
    };
  }
  const state = req.body?.state || {};
  const meta = req.body?.meta || {};
  let session_id = (req.body?.session_id || state.session_id || '').toString().trim() || null;
  if (!session_id) session_id = require('uuid').v4();
  const preRow = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
  const preThread = Array.isArray(preRow?.flow_state?.short_term_thread)
    ? preRow.flow_state.short_term_thread
    : [];
  const incomingTurnSeq = Number(req.body?.turn_seq || 0);
  const explicitScanMode = String(req.body?.scan_chat_mode || '').trim().toLowerCase() === 'true';
  let plannerDecision = null;
  let scanChatModeActive = false;
  if (req.path === '/api/public/landing-assistant/turn') {
    try {
      const { buildLandingRouteIntentPlan } = require('./landing-route-intent-planner');
      plannerDecision = buildLandingRouteIntentPlan({
        message: trimmedMessage,
        shortTermThread: preThread,
        explicitRoute: req.body?.category_route || req.body?.route || ''
      });
      const routeMetric = String(plannerDecision?.route_context?.route || 'unknown').trim().toLowerCase() || 'unknown';
      const intentMetric = String(plannerDecision?.intent_context?.intent || 'general_question').trim().toLowerCase() || 'general_question';
      const policyMetric = String(plannerDecision?.policy_pack || 'default_policy').trim().toLowerCase() || 'default_policy';
      Metrics.increment(`planner.route.${routeMetric}`, 1);
      Metrics.increment(`planner.intent.${intentMetric}`, 1);
      Metrics.increment(`planner.policy_pack.${policyMetric}`, 1);
      scanChatModeActive = !!plannerDecision?.flags?.scan_chat_mode;
    } catch (_) {}
    if (explicitScanMode) scanChatModeActive = true;
  }
  try {
    const existingScanMode = String(KellyToolExecutor._getSessionMeta(session_id, 'scan_chat_mode') || '')
      .trim()
      .toLowerCase();
    if (existingScanMode === '1' || existingScanMode === 'true') {
      scanChatModeActive = true;
    }
    if (scanChatModeActive) {
      KellyToolExecutor._setSessionMeta(session_id, 'scan_chat_mode', '1');
    }
  } catch (_) {}
  if (req.path === '/api/public/landing-assistant/turn') {
    try {
      const existingTriage = db.getTriageSession ? db.getTriageSession(session_id) : null;
      if (!existingTriage && db.upsertTriageSession) {
        db.upsertTriageSession({
          session_id,
          patient_id: null,
          quality: trimmedMessage.slice(0, 500),
          detected_language: null,
          opqrst_complete: false,
          triage_complete: false
        });
      }
    } catch (e) {
      console.warn('[landing-assistant] triage bootstrap skipped:', e.message);
    }
  }
  if (Number.isFinite(incomingTurnSeq) && incomingTurnSeq > 0) {
    const latestSeq = Number(KellyToolExecutor._getSessionMeta(session_id, 'web_voice_latest_turn_seq') || 0);
    const gate = shouldSkipLandingTurnSeq(incomingTurnSeq, latestSeq);
    if (gate.skip) {
      return {
        status: 200,
        json: {
          success: true,
          session_id,
          skipped: true,
          reason: gate.reason || 'stale_or_duplicate_turn',
          reply_seq: incomingTurnSeq,
          request_id: req.id
        }
      };
    }
  }

  if (req.path === '/api/public/landing-assistant/turn') {
    try {
      const { appendLandingContextEvent } = require('./landing-context-ingest-service');
      appendLandingContextEvent({
        sessionId: session_id,
        eventType: 'chat_turn_input',
        text: trimmedMessage,
        actor: 'user',
        source: 'turn_api',
        metadata: {
          request_id: req.id,
          path: req.path
        },
        idempotencyKey:
          String(req.body?.idempotency_key || req.get('x-idempotency-key') || '').trim() ||
          (Number.isFinite(incomingTurnSeq) && incomingTurnSeq > 0 ? `turn_seq:${incomingTurnSeq}` : `req:${req.id}`),
        expectedContextVersion: req.body?.context_version
      });
    } catch (e) {
      console.warn('[landing-assistant] context-ingest (turn) skipped:', e.message);
    }
  }

  if (isUnifiedChannelAdapterEnabled() || isUnifiedChannelAdapterShadowEnabled()) {
    try {
      const adapted = adaptIncomingEvent({
        source: req.path === '/api/public/landing-assistant/turn' ? 'landing_chat' : 'patient_chat',
        eventType: 'chat_turn',
        payload: {
          message: trimmedMessage,
          state,
          meta,
          clinic_id: req.body?.clinic_id || null,
          kelly_flow: req.body?.kelly_flow || meta?.kelly_flow || null
        },
        sessionId: session_id,
        requestId: req.id,
        metadata: {
          path: req.path,
          method: req.method
        }
      });
      req.channelAdapterEvent = adapted;
      req.channelTraceId = adapted?.envelope?.trace_id || req.id;
      if (process.env.NODE_ENV !== 'production') {
        const mode = isUnifiedChannelAdapterEnabled() ? 'primary' : 'shadow';
        console.log(
          `[channel-adapter:${mode}] trace=${req.channelTraceId} path=${req.path} event=${adapted?.envelope?.event_type || 'unknown'}`
        );
      }
    } catch (e) {
      console.warn('⚠️  channel-adapter chat adapt failed:', e.message);
    }
  }

  const row = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
  let conversationHistory = Array.isArray(row?.conversation_history) ? row.conversation_history : [];
  let existingFlowState = row?.flow_state && typeof row.flow_state === 'object' ? row.flow_state : {};
  const existingShortThread = Array.isArray(existingFlowState?.short_term_thread)
    ? existingFlowState.short_term_thread
    : [];
  const latestBarcodeContextEvent = (() => {
    for (let i = existingShortThread.length - 1; i >= 0; i -= 1) {
      const evt = existingShortThread[i];
      if (String(evt?.type || '') !== 'barcode_product_context') continue;
      if (evt && typeof evt === 'object') return evt;
    }
    return null;
  })();
  const hasLandingContextThread = existingShortThread.some((evt) => {
    const type = String(evt?.type || '');
    return type === 'barcode_product_context' || type === 'chat_turn_input' || String(evt?.text || '').includes('[Barcode Scan]');
  });
  if (req.path === '/api/public/landing-assistant/turn') {
    Metrics.increment(hasLandingContextThread ? 'landing.scan_context.present.count' : 'landing.scan_context.absent.count', 1);
  }
  if (latestBarcodeContextEvent) {
    scanChatModeActive = true;
    try {
      KellyToolExecutor._setSessionMeta(session_id, 'scan_chat_mode', '1');
    } catch (_) {}
  }
  const messageForKelly = (() => {
    const pd = latestBarcodeContextEvent?.product_data;
    if (req.path !== '/api/public/landing-assistant/turn' || !pd || typeof pd !== 'object') return trimmedMessage;
    const productName = String(pd.product_name || pd.name || '').trim();
    const categoryRoute = String(pd.category_route || pd.route || '').trim();
    const barcode = String(pd.barcode || pd.code || '').trim();
    const summaryBits = [];
    if (productName) summaryBits.push(`product_name=${productName}`);
    if (categoryRoute) summaryBits.push(`category_route=${categoryRoute}`);
    if (barcode) summaryBits.push(`barcode=${barcode}`);
    const ingredientSummary = pd.ingredient_summary && typeof pd.ingredient_summary === 'object'
      ? pd.ingredient_summary
      : null;
    const groundingMeta = pd.grounding_metadata && typeof pd.grounding_metadata === 'object'
      ? pd.grounding_metadata
      : null;
    if (ingredientSummary) {
      summaryBits.push(`ingredient_summary=${JSON.stringify(ingredientSummary)}`);
      if (groundingMeta) summaryBits.push(`grounding_metadata=${JSON.stringify(groundingMeta)}`);
    } else {
      const ingredients = String(pd.ingredients_text || '').trim();
      if (ingredients) summaryBits.push(`ingredients_text=${ingredients.slice(0, 220)}`);
    }
    if (summaryBits.length === 0) return trimmedMessage;
    return `${trimmedMessage}\n\n[Structured scan context from prior thread event]\n${summaryBits.join('\n')}`;
  })();

  // Fresh chat session only: wipe stale triage/RAG/Kelly rows when there is no orchestrate
  // row yet OR turn_count === 0 (first persisted turn). We intentionally do NOT wipe when
  // turn_count >= 1 even if RAG is missing — that would destroy in-progress triage. The Kelly
  // test harness uses a new UUID suffix per case run (run-kelly-tests.sh) so session_id does
  // not collide on shared dev DB.
  const turns = Number(row?.turn_count ?? 0);
  const orchestrateEmpty = !row || turns === 0;
  const staleResetHours = (() => {
    const n = Number(process.env.CHAT_SESSION_STALE_RESET_HOURS ?? 8);
    return Number.isFinite(n) && n > 0 ? n : 8;
  })();
  const inactiveHours = (() => {
    if (!row?.last_activity_at) return 0;
    const t = new Date(row.last_activity_at).getTime();
    if (!Number.isFinite(t)) return 0;
    return (Date.now() - t) / (1000 * 60 * 60);
  })();
  const explicitSessionReset = meta?.new_session === true || String(meta?.new_session || '').toLowerCase() === 'true';
  const staleSessionReset = !!row && turns >= 1 && inactiveHours >= staleResetHours;
  const shouldWipeClinicalState = ((orchestrateEmpty && !hasLandingContextThread) || explicitSessionReset || staleSessionReset);
  if (shouldWipeClinicalState && db?.wipeChatSessionClinicalState) {
    db.wipeChatSessionClinicalState(session_id);
    if (explicitSessionReset || staleSessionReset) {
      conversationHistory = [];
      existingFlowState = {};
    }
  }
  // P3-6: ensure pay tokens from prior sessions cannot satisfy a new conversation (F2 hygiene).
  if (shouldWipeClinicalState) {
    try {
      const KellyToolExecutor = require('./kelly-tool-executor');
      KellyToolExecutor._setSessionMeta(session_id, 'rcm_pay_token', '');
      KellyToolExecutor._setSessionMeta(session_id, 'payment_token', '');
      KellyToolExecutor._setSessionMeta(session_id, 'rcm_payment_id', '');
    } catch (_) {}
  }

  // Skincare / routine intake: same meta key as voice (Retell kelly_flow)
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');
    const rawFlow = (req.body?.kelly_flow || meta?.kelly_flow || '').toString().trim();
    const bodyRia = req.body?.routine_intake_active ?? meta?.routine_intake_active;
    const flowFromFlag =
      bodyRia != null && (String(bodyRia).toLowerCase() === '1' || String(bodyRia).toLowerCase() === 'true')
        ? 'routine_intake'
        : '';
    const flow = rawFlow || flowFromFlag;
    if (KellyOrchestratorPhase.kellyFlowActivatesRoutineIntake(flow) && !scanChatModeActive) {
      KellyToolExecutor._setSessionMeta(session_id, 'routine_intake_active', '1');
    }
  } catch (e) {
    console.warn('⚠️  chat kelly_flow → routine_intake_active:', e.message);
  }

  const preferredLanguageFromBody = (req.body?.preferred_language || meta?.preferred_language || '')
    .toString()
    .trim()
    .toLowerCase();
  const detectPreferredLanguage = () => {
    if (preferredLanguageFromBody) return preferredLanguageFromBody;
    try {
      const { detectLanguageFromText } = require('./patient-orchestrator-service');
      const detected = detectLanguageFromText(trimmedMessage)?.code || '';
      return String(detected || '').trim().toLowerCase() || '';
    } catch (_) {
      return '';
    }
  };
  const effectivePreferredLanguage = detectPreferredLanguage();

  const { runKellyTurn } = require('./kelly-turn-resolver');
  const turnOpts = {
    message: messageForKelly,
    sessionId: session_id,
    channel: 'chat',
    clinicId,
    patientId: mappedPatientId,
    patientName: null,
    patientEmail: email,
    portalSessionId,
    preferredLanguage: effectivePreferredLanguage || null,
    scanChatMode: scanChatModeActive,
    plannerDecision,
    scanGrounding: latestBarcodeContextEvent?.product_data || null
  };
  const result = await runKellyTurn(turnOpts);
  if (req.path === '/api/public/landing-assistant/turn') {
    result.reply = await translateReplyIfNeeded(result.reply, effectivePreferredLanguage);
  }
  const metricsSessionKey = `voice.metrics.session.${session_id}.`;
  const isLandingRoute = req.path === '/api/public/landing-assistant/turn';
  const isLikelyVoiceStyle = isLandingRoute;
  const flowStateOut = (result.state && typeof result.state === 'object') ? { ...result.state } : {};
  const priorThread = Array.isArray(existingFlowState?.short_term_thread) ? [...existingFlowState.short_term_thread] : [];
  const kellyThread = Array.isArray(flowStateOut.short_term_thread) ? [...flowStateOut.short_term_thread] : [];
  const shortThread = [...priorThread, ...kellyThread];
  const nowIso = new Date().toISOString();
  const extractedEmail = extractEmailFromText(trimmedMessage) || extractEmailFromText(email);
  if (extractedEmail) {
    KellyToolExecutor._setSessionMeta(session_id, 'skincare_contact_email', extractedEmail);
    shortThread.push({ type: 'contact_email_captured', at: nowIso, value: extractedEmail });
  }
  if (hasUploadSignal(trimmedMessage)) {
    shortThread.push({ type: 'upload_context', at: nowIso, text: trimmedMessage.slice(0, 240) });
  }
  const reportIntent = wantsSkinReport(trimmedMessage);
  if (reportIntent) {
    KellyToolExecutor._setSessionMeta(session_id, 'report_requested', '1');
    shortThread.push({ type: 'report_requested', at: nowIso, text: trimmedMessage.slice(0, 180) });
  }
  const reportRequested = String(KellyToolExecutor._getSessionMeta(session_id, 'report_requested') || '') === '1' || reportIntent;
  const isGuidanceComplete = result?.skincare_assessment_complete === true || result?.report_ready === true;
  const landingThreadHasBarcodeContext = (() => {
    if (latestBarcodeContextEvent) return true;
    try {
      const threads = row?.flow_state?.short_term_thread;
      if (!Array.isArray(threads)) return false;
      return threads.some(
        (e) =>
          String(e?.type || '') === 'barcode_product_context' ||
          String(e?.text || '').includes('[Barcode Scan]')
      );
    } catch (_) {
      return false;
    }
  })();
  const scanAnalysisIntent =
    /\b(analyze|analysis|build|generate)\b.*\b(skin|routine|product|ingredients|profile|snapshot|report)\b/i.test(
      trimmedMessage
    ) || /\b(skincare (result|report|snapshot)|routine analysis|product analysis)\b/i.test(trimmedMessage);
  const forceSnapshotForBarcodeSession = isLandingRoute && landingThreadHasBarcodeContext && scanAnalysisIntent;
  let reportPayload = null;
  if (isGuidanceComplete && reportRequested) {
    const reportId = `skin-report-${session_id}`;
    const reportEmail = KellyToolExecutor._getSessionMeta(session_id, 'skincare_contact_email') || extractedEmail || null;
    reportPayload = {
      report_id: reportId,
      session_id: session_id,
      generated_at: nowIso,
      delivery_email: reportEmail,
      summary: summarizeReplyForReport(result.reply),
      source: 'post_guidance_autogen'
    };
    KellyToolExecutor._setSessionMeta(session_id, 'skincare_report_json', JSON.stringify(reportPayload));
    KellyToolExecutor._setSessionMeta(session_id, 'skincare_report_generated_at', nowIso);
    shortThread.push({ type: 'report_generated', at: nowIso, report_id: reportId });
    if (!reportEmail) {
      const prompt = buildReportEmailPrompt(effectivePreferredLanguage || result.language || preferredLanguageFromBody || 'en');
      result.reply = `${String(result.reply || '').trim()} ${prompt}`.trim();
      result.next_step = result.next_step || 'collect_email_for_report';
    }
  }
  let sessionResultSnapshot = null;
  const shouldBuildSnapshot =
    isGuidanceComplete || result?.next_ui_step === 'skincare_report' || forceSnapshotForBarcodeSession;
  try {
    if (shouldBuildSnapshot) {
      const SnapshotService = require('./session-result-snapshot-service');
      const built = SnapshotService.buildSessionResultSnapshot({
        sessionId: session_id,
        source: 'landing_turn_complete'
      });
      sessionResultSnapshot = built?.snapshot || null;
      if (sessionResultSnapshot?.next_ui_step) {
        result.next_step = sessionResultSnapshot.next_ui_step;
      }
    }
  } catch (e) {
    console.warn('[landing-assistant] snapshot build skipped:', e.message);
  }
  const semanticContract = sessionResultSnapshot?.result_summary?.semantic_contract || null;
  const preRouteTurn = !landingThreadHasBarcodeContext;
  result.reply = enforceRouteContractOnChatReply({
    reply: result.reply,
    semanticContract,
    preRoute: preRouteTurn
  });
  const hasScanContextPayload = !!(latestBarcodeContextEvent && latestBarcodeContextEvent.product_data);
  const genericFallbackOnScan = (() => {
    const txt = String(result.reply || '').toLowerCase();
    if (!txt) return false;
    return (
      txt.includes('what symptom or concern should we focus on next') ||
      txt.includes("i don't see a scanned product") ||
      txt.includes('what product did you scan') ||
      txt.includes("i don't see a specific product")
    );
  })();
  if (isLandingRoute && hasScanContextPayload && genericFallbackOnScan) {
    const pd = latestBarcodeContextEvent.product_data || {};
    const productName = String(pd.product_name || pd.name || 'this scanned product').trim();
    const categoryRoute = String(pd.category_route || pd.route || 'product').trim().toLowerCase();
    const ingredientHint = String(pd.ingredients_text || '').trim();
    const routeHint =
      categoryRoute === 'food' || categoryRoute === 'supplement'
        ? `Based on your ${categoryRoute} scan, `
        : 'Based on your scanned product, ';
    const ingredientLine = ingredientHint
      ? `I can see ingredients: ${ingredientHint.slice(0, 140)}. `
      : '';
    result.reply =
      `${routeHint}for ${productName}, "low risk" usually means low chance of harm for typical use, while "generally safe for children" is a stricter pediatric safety bar. ` +
      `${ingredientLine}If you want, I can give a short child-safety interpretation specific to this product category.`;
  }
  if (isLandingRoute && hasScanContextPayload) {
    const pd = latestBarcodeContextEvent.product_data || {};
    const lowConfidence =
      pd?.grounding_metadata?.low_confidence === true ||
      (() => {
        const total = Number(pd?.ingredient_summary?.total_ingredients || 0);
        const unresolved = Number(pd?.ingredient_summary?.confidence_distribution?.low_or_unresolved || 0);
        return total > 0 && (unresolved / total) > 0.3;
      })();
    if (lowConfidence) {
      const replyLc = String(result.reply || '').toLowerCase();
      const hasFallbackHint =
        replyLc.includes('low confidence') ||
        replyLc.includes('manual ingredient') ||
        replyLc.includes('label photo');
      if (!hasFallbackHint) {
        result.reply = `${String(result.reply || '').trim()} I have low-confidence ingredient matching for this scan, so please upload a clear label photo or paste the ingredient list to confirm before any strong safety recommendation.`.trim();
      }
    }
  }
  if (isLandingRoute && hasScanContextPayload) {
    const replyLc = String(result.reply || '').toLowerCase();
    const scanReferenced = /(barcode|scan|product|ingredient|category route|low risk|generally safe|children)/i.test(replyLc);
    Metrics.increment(scanReferenced ? 'landing.scan_context.used_in_reply.count' : 'landing.scan_context.missed_in_reply.count', 1);
  }
  if (plannerDecision && typeof plannerDecision === 'object') {
    flowStateOut.turn_planner = {
      ...plannerDecision,
      planned_at: nowIso
    };
    shortThread.push({
      type: 'turn_planner_decision',
      at: nowIso,
      route: plannerDecision?.route_context?.route || 'unknown',
      intent: plannerDecision?.intent_context?.intent || 'general_question',
      policy_pack: plannerDecision?.policy_pack || 'default_policy'
    });
  }
  flowStateOut.short_term_thread = shortThread.slice(-20);
  if (isLikelyVoiceStyle) {
    const replyText = String(result.reply || '');
    const questionCount = (replyText.match(/\?/g) || []).length;
    const assistantWords = tokenize(replyText).length;
    const prevAssistants = conversationHistory
      .filter((m) => m && m.role === 'assistant' && m.content)
      .slice(-2)
      .map((m) => String(m.content));
    const looksRephrase = prevAssistants.some((p) => jaccard(p, replyText) >= 0.72);
    Metrics.increment('voice.metrics.assistant_turns', 1);
    Metrics.increment(`${metricsSessionKey}assistant_turns`, 1);
    Metrics.increment('voice.metrics.assistant_words_total', assistantWords);
    Metrics.increment(`${metricsSessionKey}assistant_words_total`, assistantWords);
    if (questionCount > 1) {
      Metrics.increment('voice.metrics.multi_question_turns', 1);
      Metrics.increment(`${metricsSessionKey}multi_question_turns`, 1);
    }
    if (looksRephrase) {
      Metrics.increment('voice.metrics.rephrase_within_2_turns', 1);
      Metrics.increment(`${metricsSessionKey}rephrase_within_2_turns`, 1);
    }
    const firstUserAtRaw = KellyToolExecutor._getSessionMeta(session_id, 'voice_first_user_turn_at_ms');
    if (!firstUserAtRaw) {
      KellyToolExecutor._setSessionMeta(session_id, 'voice_first_user_turn_at_ms', String(Date.now()));
    }
    const firstHelpfulRaw = KellyToolExecutor._getSessionMeta(session_id, 'voice_first_helpful_response_at_ms');
    const helpful = assistantWords >= 8 && !/\bi'?m here\b/i.test(replyText);
    if (!firstHelpfulRaw && helpful) {
      const nowMs = Date.now();
      KellyToolExecutor._setSessionMeta(session_id, 'voice_first_helpful_response_at_ms', String(nowMs));
      const firstUserAt = Number(KellyToolExecutor._getSessionMeta(session_id, 'voice_first_user_turn_at_ms') || nowMs);
      const delta = Math.max(0, nowMs - firstUserAt);
      Metrics.increment('voice.metrics.time_to_first_helpful_response_ms_total', delta);
      Metrics.increment('voice.metrics.time_to_first_helpful_response_ms_count', 1);
      Metrics.increment(`${metricsSessionKey}time_to_first_helpful_response_ms`, delta);
    }
  }

  // Always persist chat conversation history so the next turn has the right
  // triage/OPQRST state even when the LLM/tool loop had to fall back.
  if (db?.upsertOrchestrateSession) {
    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: trimmedMessage },
      { role: 'assistant', content: result.reply }
    ];
    const baseTurnCount = (explicitSessionReset || staleSessionReset) ? 0 : (row?.turn_count || 0);
    const newTurnCount = baseTurnCount + 1;
    let preferredLanguage = row?.preferred_language || 'en';
    if (preferredLanguageFromBody === 'en') {
      preferredLanguage = 'en';
    }
    // orch-4: Persist preferred_language from first 1–2 turns or explicit language request
    try {
      const { detectLanguageFromText, detectLanguagePreferenceRequest } = require('./patient-orchestrator-service');
      const langReq = detectLanguagePreferenceRequest(trimmedMessage);
      if (langReq?.isLanguageRequest && langReq?.code) {
        preferredLanguage = langReq.code;
      } else if (preferredLanguageFromBody !== 'en' && newTurnCount <= 2) {
        preferredLanguage = detectLanguageFromText(trimmedMessage).code || preferredLanguage;
      }
    } catch (_) {}
    try {
      db.upsertOrchestrateSession({
        session_id,
        channel: 'chat',
        patient_id: mappedPatientId,
        portal_session_id: portalSessionId,
        clinic_id: clinicId,
        conversation_history: updatedHistory,
        flow_state: flowStateOut || existingFlowState || state,
        turn_count: newTurnCount,
        preferred_language: preferredLanguage
      });
      if (Number.isFinite(incomingTurnSeq) && incomingTurnSeq > 0) {
        KellyToolExecutor._setSessionMeta(session_id, 'web_voice_latest_turn_seq', String(incomingTurnSeq));
      }
    } catch (e) {
      console.warn('⚠️  Failed to persist chat session:', e.message);
    }
  }

  // Rebuild snapshot after persistence so report payload includes the just-finished turn.
  try {
    if (shouldBuildSnapshot) {
      const SnapshotService = require('./session-result-snapshot-service');
      const rebuilt = SnapshotService.buildSessionResultSnapshot({
        sessionId: session_id,
        source: 'landing_turn_post_persist'
      });
      sessionResultSnapshot = rebuilt?.snapshot || sessionResultSnapshot;
      if (sessionResultSnapshot?.next_ui_step) {
        result.next_step = sessionResultSnapshot.next_ui_step;
      }
    }
  } catch (e) {
    console.warn('[landing-assistant] post-persist snapshot build skipped:', e.message);
  }

  const reply = (result.reply && String(result.reply).trim()) || "I am here with you. Tell me what is bothering your skin most right now.";
  const responseLanguage =
    String(result.language || effectivePreferredLanguage || preferredLanguageFromBody || 'en')
      .trim()
      .toLowerCase() || 'en';
  return {
    status: 200,
    json: {
      success: true,
      reply,
      session_id: session_id,
      state: flowStateOut || state,
      // Expose tool usage for E2E metrics harness (used by scripts/run-kelly-tests.sh)
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      next_chips: result.next_chips || [],
      clear_chips: !Array.isArray(result.next_chips) || result.next_chips.length === 0,
      chips_display: result.chips_display,
      redirect_to: result.redirect_to,
      next_step: result.next_step,
      provider_cards: Array.isArray(result.provider_cards) ? result.provider_cards : undefined,
      literature_snippets: Array.isArray(result.literature_snippets) ? result.literature_snippets : undefined,
      language: responseLanguage,
      preferred_language: responseLanguage,
      report: reportPayload || undefined,
      session_result_snapshot: sessionResultSnapshot || undefined,
      reply_seq: Number.isFinite(incomingTurnSeq) && incomingTurnSeq > 0 ? incomingTurnSeq : undefined,
      short_term_thread: flowStateOut.short_term_thread || [],
      request_id: req.id
    }
  };
}

async function handlePatientTriageMessage(req) {
  const PatientPortalService = require('./patient-portal-service');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  return runKellyTriageTurnForHttpRequest(req, { mappedPatientId, email, portalSessionId: sid });
}

/** Somo public landing assistant — same Kelly triage stack as /api/patient/triage/message (rate-limited). */
async function handlePublicLandingAssistantFromRequest(req) {
  const { startTrace, endTrace } = require('./langsmith-trace-service');
  const sessionId = String(req.body?.session_id || '').trim() || null;
  const traceCtx = await startTrace({
    name: 'landing_assistant_turn',
    inputs: {
      session_id: sessionId,
      message: String(req.body?.message || ''),
      category_route: String(req.body?.category_route || req.body?.route || '').trim() || null,
      scan_chat_mode: String(req.body?.scan_chat_mode || '').trim() || null
    },
    metadata: {
      route: '/api/public/landing-assistant/turn',
      source: 'landing_page'
    },
    tags: ['landing-page', 'chat', 'kelly']
  });
  try {
    const out = await runKellyTriageTurnForHttpRequest(req, { mappedPatientId: null, email: null, portalSessionId: null });
    await endTrace(traceCtx, {
      outputs: {
        success: !!out?.json?.success,
        status: out?.status || 200,
        session_id: out?.json?.session_id || sessionId,
        next_step: out?.json?.next_step || null,
        scan_chat_mode: String(out?.json?.state?.turn_planner?.flags?.scan_chat_mode || '').trim() || null
      },
      usage: out?.json?.llm_usage || null
    });
    return out;
  } catch (e) {
    await endTrace(traceCtx, { error: e?.message || 'landing_assistant_turn_failed' });
    throw e;
  }
}

async function handlePatientTriageFromRequest(req) {
  const PatientPortalService = require('./patient-portal-service');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  return runKellyTriageTurnForHttpRequest(req, { mappedPatientId, email, portalSessionId: sid });
}

module.exports = {
  runKellyTriageTurnForHttpRequest,
  handlePatientTriageFromRequest,
  handlePublicLandingAssistantFromRequest,
};
