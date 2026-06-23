/**
 * KellyAgentService
 *
 * The LLM engine that powers Kelly on both voice and chat.
 * Default: Claude (Anthropic) with Groq as fallback (see LLMRouter.resolvePrimaryProvider).
 * Override with KELLY_PRIMARY_PROVIDER=groq for Groq-only.
 *
 * Replaces PatientOrchestratorService as the reply generator.
 * PatientOrchestratorService is kept only for session persistence and emergency pre-check.
 *
 * Flow:
 *   1. detectRedFlags (before LLM — safety is non-negotiable)
 *   2. Build conversation history from session
 *   3. Call LLM (Claude primary / Groq fallback) with Kelly system prompt + tools
 *   4. If tool_calls → execute via ToolExecutor → append results → call LLM again
 *   5. Return final text reply
 *
 * Usage:
 *   Prefer kelly-turn-resolver / KELLY_RAILS_V2=1 for new work.
 *   const result = await KellyAgentService.processTurn({
 *     message, sessionId, channel, clinicId, patientId, callerPhone, patientName
 *   });
 *   // result.reply   — text to send back
 *   // result.endCall — true if Kelly said goodbye
 */

'use strict';

const Groq = require('groq-sdk');
const LLMRouter = require('../../shared/llm-router');
const { resolvePrimaryProvider, callStreamWithDeltas } = LLMRouter;
const db = require('../../../database');
const { normalizeToE164 } = require('../../../utils/phone-e164');

// Startup config log — confirm intended Kelly LLM path (fix-startup)
(function _logKellyConfig() {
  if (process.env.KELLY_QUIET === '1' || process.env.KELLY_QUIET === 'true') return;
  if (process.env.NODE_ENV === 'production' && process.env.KELLY_LOG_STARTUP !== '1' && process.env.KELLY_LOG_STARTUP !== 'true') {
    return;
  }
  const provider = resolvePrimaryProvider();
  const anthKey = process.env.ANTHROPIC_API_KEY || '';
  const model = process.env.KELLY_ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const timeout = process.env.KELLY_TURN_TIMEOUT_MS || '25000';
  console.log('[KellyAgent] Config: KELLY_PRIMARY_PROVIDER=%s, ANTHROPIC_API_KEY=%s..., KELLY_ANTHROPIC_MODEL=%s, KELLY_TURN_TIMEOUT_MS=%s',
    provider,
    anthKey ? anthKey.slice(0, 8) + '...' : '(not set)',
    model,
    timeout
  );
})();
const { detectRedFlags } = require('../../clinical/triage-service');
/** Phase 5: optional Kelly tool `run_derm_patient_qa` when DERM_EDUCATION_PIPELINE_ENABLED=true */
const DERM_EDUCATION_PIPELINE_ENABLED =
  String(process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'false').toLowerCase() === 'true';
const KellyToolExecutor = require('../kelly-tool-executor');
const { redactObject } = require('../../platform/redaction-service');
const TriageRAGService = require('../../clinical/triage-rag-service');
const KellyOrchestratorPhase = require('../kelly-orchestrator-phase');
const KellyPromptBuilder = require('../kelly-prompt-builder');
const SessionStateStore = require('../../shared/session-state-store');
const IntakeRequiredFields = require('../../shared/intake-required-fields');
const AskNextQuestionService = require('../../clinical/ask-next-question-service');
const SafetyPreScreen = require('../../shared/safety-prescreen');
const QueryPlanner = require('../../shared/query-planner');
const CarePathCatalog = require('../../platform/care-path-catalog');
const EvidenceFusion = require('../../shared/evidence-fusion');
const CaseSummaryComposer = require('../../clinical/case-summary-composer');
const CasePatternsService = require('../../platform/case-patterns-service');
const BillingReadinessPack = require('../../rcm/billing-readiness-pack');
const ClinicalRecommendationPolicy = require('../../clinical/clinical-recommendation-policy');
const Metrics = require('../../shared/metrics');
const { resolveSkinType } = require('../../clinical/skin-type-resolver');
const { resolveSkinConditions } = require('../../shared/skin-condition-resolver');
const { resolveSkinConflicts } = require('../../shared/skin-conflict-resolver');
const { resolveBaumannCode } = require('../../platform/baumann-skin-map-resolver');
const { resolveIngredientFacts, evaluateIngredientSafety } = require('../../catalog/ingredient-ontology-resolver');
const { mapProductCategory } = require('../../catalog/product-category-mapper');
const { resolveTaxonomyGraphAction } = require('../../catalog/taxonomy-graph-resolver');
const { formatRoutineIntakeSummaryFromTriageRow } = KellyPromptBuilder;
const SKIN_TAXONOMY_SHADOW_MODE = String(process.env.SKIN_TAXONOMY_SHADOW_MODE || '0') === '1';
const SKIN_CONFLICT_HARD_GUARD = String(process.env.SKIN_CONFLICT_HARD_GUARD || '1') === '1';
const GRAPH_GATE_ENFORCE = String(process.env.GRAPH_GATE_ENFORCE || '0') === '1';
const KELLY_PRODUCT_TAXONOMY_CAPTURE = String(process.env.KELLY_PRODUCT_TAXONOMY_CAPTURE || '0') === '1';

// ─────────────────────────────────────────────────────────────
// Groq client (lazy init so missing key doesn't crash on import)
// ─────────────────────────────────────────────────────────────
let _groq = null;
function getGroq() {
  if (_groq) return _groq;
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');
  _groq = new Groq({ apiKey: key });
  return _groq;
}

// Model to use — llama-3.3-70b-versatile is the best Groq model for function calling
const GROQ_MODEL = process.env.KELLY_GROQ_MODEL || 'llama-3.3-70b-versatile';
// Fallback when primary hits rate limit (429); 8b has higher free-tier limits
const GROQ_FALLBACK_MODEL = process.env.KELLY_GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant';

// Max history turns to send (token budget)
const MAX_HISTORY_TURNS = parseInt(process.env.KELLY_MAX_HISTORY_TURNS || '12', 10);

// Hard cap to prevent large triage/RAG history from pushing the Groq request over TPM limits.
const MAX_HISTORY_CONTENT_CHARS_VOICE = parseInt(process.env.KELLY_HISTORY_CONTENT_CHARS_VOICE || '1200', 10);
const MAX_HISTORY_CONTENT_CHARS_CHAT = parseInt(process.env.KELLY_HISTORY_CONTENT_CHARS_CHAT || '1600', 10);

function _truncateForLLM(content, maxChars) {
  const s = content == null ? '' : String(content);
  if (!maxChars || s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '…';
}

function _isNegatedEmergencyStatement(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\bno\s+chest\s+pain\b/.test(t) &&
    /\bno\s+shortness\s+of\s+breath\b/.test(t)
  ) || (
    /\bdenies\s+chest\s+pain\b/.test(t) &&
    /\bdenies\s+shortness\s+of\s+breath\b/.test(t)
  );
}

function _isSummaryRequest(text) {
  const t = String(text || '').toLowerCase();
  return (
    (/\bsummar(?:y|ize)\b/.test(t) && /\b(captured|so far|what you got|what you heard)\b/.test(t)) ||
    /\bwhat did you capture\b/.test(t) ||
    /\bwhat did you hear\b/.test(t) ||
    /\bwhat have you captured\b/.test(t)
  );
}

function _extractLikelyBarcode(text) {
  const msg = String(text || '');
  const hint = /\b(barcode|upc|ean|scan)\b/i.test(msg);
  const matches = msg.match(/\b\d{8,14}\b/g) || [];
  if (!matches.length) return null;
  if (!hint && matches.length > 1) return null;
  const candidate = String(matches[0] || '').trim();
  return candidate || null;
}

async function _tryCaptureProductTaxonomyFromMessage({ sessionId, message }) {
  if (!KELLY_PRODUCT_TAXONOMY_CAPTURE) return null;
  const barcode = _extractLikelyBarcode(message);
  if (!barcode) return null;
  try {
    const { resolveProductIdentityFromBarcode } = require('../../catalog/product-identity-resolver');
    const {
      upsertFromBeautyFacts,
      upsertProductTaxonomyFullPipeline,
      logBarcodeLookup
    } = require('../../catalog/product-taxonomy-repository');
    const out = await resolveProductIdentityFromBarcode(barcode);
    if (!out?.success || !out?.normalized?.found) {
      logBarcodeLookup({
        barcode,
        source: 'kelly_chat_barcode',
        hit: false,
        details: { error: out?.error || 'not_found' }
      });
      return null;
    }
    const full = String(process.env.PRODUCT_TAXONOMY_FULL_ENRICH || '0') === '1';
    const saved = full
      ? await upsertProductTaxonomyFullPipeline(out.normalized)
      : upsertFromBeautyFacts(out.normalized);
    logBarcodeLookup({
      barcode: out.normalized?.barcode || barcode,
      source: 'kelly_chat_barcode',
      hit: !!saved?.ok,
      productId: saved?.product_id,
      gradeClass: saved?.grade?.grade_class,
      confidence: saved?.grade?.confidence,
      details: { session_id: sessionId, product_name: out.normalized?.product_name || null }
    });
    if (saved?.ok && KellyToolExecutor._setSessionMeta) {
      KellyToolExecutor._setSessionMeta(sessionId, 'step1_last_barcode', String(out.normalized?.barcode || barcode));
      KellyToolExecutor._setSessionMeta(sessionId, 'step1_last_product_id', String(saved.product_id || ''));
      KellyToolExecutor._setSessionMeta(sessionId, 'step1_last_product_grade', String(saved?.grade?.grade_class || ''));
    }
    return saved?.ok ? saved : null;
  } catch (e) {
    try { Metrics.increment('product_taxonomy.kelly_capture_error.count', 1); } catch (_) {}
    console.warn('[KellyAgent] barcode taxonomy capture failed:', e?.message || e);
    return null;
  }
}

function _hasSkinTypeCorrectionIntent(text) {
  const t = String(text || '').toLowerCase();
  return /\b(actually|correction|correct|update|changed|more like|rather|not )\b/.test(t);
}

/**
 * When skin type is still unknown/low-confidence, Kelly normally short-circuits with a fixed
 * skin-type question. Skip that for asks that are clearly about face/vision/product analysis
 * so the user's question reaches the LLM (e.g. "describe my face" vs oily/dry intake).
 */
function _defersStep1SkinTypeClarifier(message) {
  const t = String(message || '').trim().toLowerCase();
  if (!t) return false;
  if (/\bdescribe my (face|skin)\b/.test(t)) return true;
  if (/\b(what do you see|what can you see)\b/.test(t) && /\b(face|camera|photo|picture|selfie|image)\b/.test(t)) {
    return true;
  }
  if (/\b(describe|analyze|analyse)\b/.test(t) && /\b(my |the )?(face|selfie|photo|picture|camera)\b/.test(t)) {
    return true;
  }
  if (/\b(how does|how do)\b.*\b(my face|my skin)\b.*\b(look)\b/.test(t)) return true;
  // Product / scan context should not be replaced by generic skin-type intake.
  if (/\b(barcode|ingredients?|i scanned|this product)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Skip Step1 skin-type clarifier for clinic derm / booking when not in skincare routine intake (F2 E2E). */
function _skipStep1SkinClarifierForClinicVisit(sessionId, message) {
  if (_sessionMetaBool(sessionId, 'routine_intake_active')) return false;
  const msg = String(message || '').toLowerCase();
  const clinicalDerm =
    /\b(rash|itch|dermat|skin concern|mole|eczema|psoriasis|hives|spot|lesion|forearm|scaly|pelvic|gynecolog|obgyn|ob\/gyn|period|symptom|pain|fever)\b/.test(
      msg
    );
  const booking =
    KellyOrchestratorPhase.isExplicitBookingIntent(message) ||
    /\b(appointment|book|visit|clinic|see a doctor|dermatolog)\b/.test(msg);
  const phase = String(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_orchestrator_phase') || '').toUpperCase();
  return clinicalDerm || booking || phase === 'BOOKING' || phase === 'TRIAGE_ACTIVE' || phase === 'TRIAGE_DISCOVERY';
}

function _isClinicalVisitMessage(message) {
  const msg = String(message || '').toLowerCase();
  if (
    /\b(rash|itch|dermat|skin concern|mole|eczema|psoriasis|hives|spot|lesion|forearm|scaly|pelvic|gynecolog|obgyn|ob\/gyn|period|symptom|pain|fever)\b/.test(
      msg
    )
  ) {
    return true;
  }
  if (KellyOrchestratorPhase.isExplicitBookingIntent(message)) return true;
  if (/\b(appointment|book|visit|clinic|see a doctor|dermatolog)\b/.test(msg)) return true;
  return KellyOrchestratorPhase.isRescheduleCancelIntent(message);
}

/** I2-6: skip all Step1 early returns when graph routes clinical intake or visit is clinical. */
function _shouldSkipStep1ForTurn(sessionId, message, graphHost = null) {
  if (graphHost?.clinicalIntake || graphHost?.skipStep1) return true;
  if (_sessionMetaBool(sessionId, 'routine_intake_active') && !graphHost?.clinicalIntake) return false;
  if (_skipStep1SkinClarifierForClinicVisit(sessionId, message)) return true;
  const branch = String(KellyToolExecutor._getSessionMeta(sessionId, 'kelly_graph_branch') || '').toLowerCase();
  if (branch === 'clinical_intake') return true;
  if (process.env.LANGGRAPH_KELLY_ENABLED === '0') return false;
  if (_sessionMetaBool(sessionId, 'kelly_graph_active') && _isClinicalVisitMessage(message)) return true;
  return false;
}

function _looksLikeScanConversation(message) {
  const t = String(message || '').trim().toLowerCase();
  if (!t) return false;
  return /\b(scan|scanned|barcode|ingredients?|food scan|supplement|open food facts|category route|low risk|generally safe|good for children|child[- ]?safety|additive|dye)\b/.test(
    t
  );
}

function _extractExplicitSkinType(text) {
  const t = String(text || '').toLowerCase();
  if (/\bnot\s+oily\b/.test(t) && /\b(dry|tight|flaky)\b/.test(t)) return 'dry';
  if (/\bnot\s+dry\b/.test(t) && /\b(oily|greasy|shiny)\b/.test(t)) return 'oily';
  if (/\bnot\s+oily\b/.test(t) && /\b(dry\s+cheeks?|oily\s+(t-zone|nose))\b/.test(t)) return 'combination';
  if (/\bcombination|combo\b/.test(t)) return 'combination';
  if (/\boily|greasy\b/.test(t) && !/\bnot\s+oily\b/.test(t)) return 'oily';
  if (/\bdry|flaky|tight\b/.test(t)) return 'dry';
  if (/\bsensitive|reactive\b/.test(t)) return 'sensitive';
  if (/\bnormal|balanced\b/.test(t)) return 'normal';
  return '';
}

function _negatesSkinType(text, skinType) {
  const t = String(text || '').toLowerCase();
  const s = String(skinType || '').toLowerCase();
  if (!s) return false;
  const tokenMap = {
    oily: 'oily',
    dry: 'dry',
    combination: 'combination',
    sensitive: 'sensitive',
    normal: 'normal'
  };
  const tok = tokenMap[s] || s;
  return new RegExp(`\\b(not|don't have|do not have|no)\\s+${tok}\\b`, 'i').test(t);
}

function _composeCapturedSummaryFromState(state) {
  const s = state || {};
  const complaint = String(s.chief_complaint || s.quality || '').trim();
  const onset = String(s.timeline || s.onset || '').trim();
  const severity = s.severity != null && String(s.severity).trim() !== '' ? String(s.severity).trim() : '';
  const provocation = String(s.provocation || '').trim();
  const bits = [];
  if (complaint) bits.push(`you reported ${complaint}`);
  if (onset) bits.push(`it started ${onset}`);
  if (severity) bits.push(`severity is about ${severity}/10`);
  if (provocation) bits.push(`it is better/worse with ${provocation}`);
  if (!bits.length) return '';
  return `So far, ${bits.join(', ')}. I can keep refining this with one more detail if needed.`;
}

function _buildIngredientGroundingBlock(scanGrounding) {
  const g = scanGrounding && typeof scanGrounding === 'object' ? scanGrounding : null;
  if (!g) return '';
  const summary = g.ingredient_summary && typeof g.ingredient_summary === 'object'
    ? g.ingredient_summary
    : null;
  const meta = g.grounding_metadata && typeof g.grounding_metadata === 'object'
    ? g.grounding_metadata
    : {};
  if (!summary) return '';
  const flagged = Array.isArray(summary.flagged_ingredients) ? summary.flagged_ingredients : [];
  const confidence = summary.confidence_distribution && typeof summary.confidence_distribution === 'object'
    ? summary.confidence_distribution
    : {};
  const unresolved = Number(confidence.low_or_unresolved || 0);
  const total = Number(summary.total_ingredients || 0);
  const lowConfidence = meta.low_confidence === true || (total > 0 && (unresolved / total) > 0.3);
  const flaggedText = flagged.length
    ? flagged.slice(0, 6).map((f) => `${f.name || 'ingredient'} (${f.reason || 'flag'})`).join(', ')
    : 'none';
  return [
    '## Structured ingredient context (authoritative)',
    '- If this section exists, use it as the source of truth.',
    '- Do NOT re-parse raw `ingredients_text`.',
    `- Total ingredients: ${total}; resolved: ${Number(summary.resolved_count || 0)}.`,
    `- Confidence distribution: ${JSON.stringify(confidence)}.`,
    `- Flagged ingredients: ${flaggedText}.`,
    `- Enrichment version: ${String(meta.enrichment_version || 'unknown')}.`,
    lowConfidence
      ? '- Deterministic fallback: acknowledge low-confidence enrichment and ask for label photo/manual ingredient text before strong claims.'
      : '- Deterministic fallback: if user asks safety/efficacy, cite flagged ingredients and confidence distribution in answer.'
  ].join('\n');
}

function _hashTurnText(text) {
  const s = String(text || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return String(h >>> 0);
}

function _extractBodySites(text) {
  const t = String(text || '').toLowerCase();
  const map = [
    ['face', /\b(face|facial|cheek|chin|forehead|jaw)\b/],
    ['neck', /\bneck\b/],
    ['chest', /\bchest\b/],
    ['back', /\bback\b/],
    ['arm', /\barm|arms|elbow|elbows\b/],
    ['leg', /\bleg|legs|thigh|calf|knees?\b/],
    ['hand', /\bhand|hands|wrist|wrists|finger|fingers\b/],
    ['foot', /\bfoot|feet|ankle|ankles|toe|toes\b/],
    ['scalp', /\bscalp\b/]
  ];
  return map.filter(([, re]) => re.test(t)).map(([label]) => label);
}

function _extractStep1Fields(message) {
  const text = String(message || '').trim();
  if (!text) return { fields: {}, fieldsFilled: 0 };
  const out = {};
  if (!/^(hi|hello|hey|ok|okay|thanks?)\b/i.test(text) && text.length >= 8) {
    out.chief_complaint = text.slice(0, 280);
  }
  const sev = text.match(/\b([1-9]|10)\s*(?:\/\s*10|out of 10)\b/i);
  if (sev) out.severity = Number(sev[1]);
  const timeline = text.match(/\b(today|yesterday|last night|this morning|(\d+\s*(day|days|week|weeks|month|months)\s+ago)|since\s+[a-z0-9\s-]{2,24})\b/i);
  if (timeline) out.timeline = timeline[1];
  const sites = _extractBodySites(text);
  if (sites.length) out.body_sites = sites;
  const fieldsFilled = Object.keys(out).filter((k) => {
    if (k === 'body_sites') return Array.isArray(out[k]) && out[k].length > 0;
    return out[k] != null && String(out[k]).trim() !== '';
  }).length;
  return { fields: out, fieldsFilled };
}

/**
 * E2E / harness: if slots are reported but the model path skipped emitting run_triage_rag while
 * a RAG row exists (e.g. rate-limit server-side RAG + get_available_slots), prepend run_triage_rag
 * so tool-order metrics match what actually happened.
 */
function _toolsUsedEnsureRagBeforeSlots(sessionId, tools) {
  return Array.isArray(tools) ? [...tools] : [];
}

function _kellyDebugTurn(tag, payload) {
  if (process.env.KELLY_DEBUG_TURN !== '1' && process.env.KELLY_DEBUG_TURN !== 'true') return;
  try {
    const sid = payload.sessionId != null ? String(payload.sessionId) : '';
    console.log('[KellyDebug]', tag, JSON.stringify({ ...payload, sessionId: sid ? `${sid.slice(0, 10)}…` : '' }));
  } catch (_) {}
}

/** Slot/contact/inject/tool-payload traces. Set KELLY_DEBUG=1 — off in production by default. */
function _kellyDebugVerbose() {
  return process.env.KELLY_DEBUG === '1' || process.env.KELLY_DEBUG === 'true';
}

/**
 * Compact system prompt for fallback models.
 * Groq TPM limits can be hit when the full prompt + tool payloads are too large.
 * Keep this intentionally short; it is used only for fallback retries.
 */
function _buildCompactSystemPrompt(context) {
  const { channel, preferredLanguage, orchestration } = context || {};
  const isVoice = channel === 'voice';
  const orchHint =
    KellyOrchestratorPhase.orchestratorEnabled() && orchestration
      ? ` Phase: ${orchestration.phase}.`
      : '';
  return `You are Kelly (Somo).${orchHint}

GOAL: triage OPQRST and route to the right specialist, verify insurance, quote copay, then book.

TOOL ORDER (hard rule):
1) get_triage_session → store_triage_opqrst → store_triage_rich_intake → run_triage_rag
2) collect_insurance → compute_visit_quote
3) get_available_slots → schedule_appointment → create_appointment_checkout → verify_checkout_code
NEVER schedule before triage_complete and insurance quote when payer info is available.

EMERGENCY: chest pain / stroke symptoms / suicidal intent → say call 911 immediately and stop tools.

RESPONSE STYLE:
${isVoice ? 'VOICE: 1-2 short sentences.' : 'CHAT: concise and clear.'}
${preferredLanguage && preferredLanguage !== 'en' ? `Language: ${preferredLanguage}` : ''}`;
}

function _replyForTriageIncomplete(errorCode, channel, preferredLanguage, sessionRow, userMessage) {
  const TRIAGE_ERROR_MESSAGES = {
    TRIAGE_REQUIRED: "To find the right specialist, I need one quick detail first: what's the main symptom or concern bothering you today?",
    TRIAGE_INCOMPLETE: "I'm almost done with triage. Can you describe the main thing you're experiencing?",
    LOW_CONFIDENCE: 'Just one more detail - can you describe what it feels like (for example: sharp, dull, constant, or comes and goes)?',
    DIFFERENTIALS_REQUIRED: "I need a bit more to route you correctly. What's the main symptom bringing you in?",
    OPQRST_REQUIRED: 'I need to collect a bit of medical history before booking. When did this start?',
    RICH_INTAKE_REQUIRED: 'Are you currently taking any medications?',
    SAFETY_BLOCKED: 'Based on what you have described, please call 911 or go to your nearest emergency room right away.'
  };
  if (TRIAGE_ERROR_MESSAGES[errorCode]) return TRIAGE_ERROR_MESSAGES[errorCode];

  // Server-side guardrail: avoid tool-call spirals when triage is incomplete.
  // We ask ONE OPQRST field at a time (voice UX) and acknowledge what the user just said.
  const stored = sessionRow || {};
  const msg = String(userMessage || '').toLowerCase();
  const langHint = preferredLanguage && preferredLanguage !== 'en' ? ` (${preferredLanguage})` : '';
  const isVoice = channel === 'voice';
  const lang = (preferredLanguage || 'en').toLowerCase();
  const routineMode = (() => {
    try {
      const sid = stored?.session_id || stored?.id || null;
      if (!sid) return false;
      const v = KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sid, 'routine_no_symptoms') : null;
      if (String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true') return true;
      const rows = db.db.prepare(`
        SELECT content
        FROM kelly_conversation_history
        WHERE session_id = ? AND role = 'user'
        ORDER BY created_at DESC
        LIMIT 12
      `).all(sid);
      const corpus = rows.map((r) => String(r?.content || '').toLowerCase()).join('\n');
      return (
        /\b(no symptoms?|without symptoms?|don't have symptoms?|do not have symptoms?|routine visit|annual check|just routine)\b/i.test(corpus) ||
        /\b(нет симптом|без симптом|только осмотр|профилактическ)\b/i.test(corpus)
      );
    } catch (_) {
      return false;
    }
  })();
  const isNoSymptoms =
    /\b(no symptoms?|without symptoms?|don't have symptoms?|do not have symptoms?|just routine|routine visit|annual check)\b/i.test(msg) ||
    /\b(нет симптом|без симптом|только осмотр|профилактическ)\b/i.test(msg);

  const i18n = (key, fallback) => {
    const t = {
      ru: {
        ask_onset: 'Когда это началось?',
        ask_quality_rash: 'Как это ощущается - зуд, жжение или боль?',
        ask_quality_pain: 'Как бы вы описали боль - острая, тупая, пульсирующая или жгучая?',
        ask_quality_generic: 'Что вы чувствуете?',
        ask_severity: 'Оцените по шкале от 1 до 10.',
        ask_timing: 'Это постоянно или приходит и уходит?',
        ask_quality_final: 'Опишите, пожалуйста, характер ощущений (например: зуд, жжение, острая боль).',
        no_symptoms: 'Поняла. Если активных симптомов нет, можем перейти к обычному визиту. Вам нужно к врачу срочно сейчас или хотите запланировать прием на позже? И какая дата вам подходит?'
      },
      es: {
        ask_onset: 'Cuando comenzo?',
        ask_quality_rash: 'Como se siente: picazon, ardor o dolor?',
        ask_quality_pain: 'Como describiria el dolor: punzante, sordo, pulsante o ardor?',
        ask_quality_generic: 'Que sensacion tiene?',
        ask_severity: 'Que tan fuerte es del 1 al 10?',
        ask_timing: 'Es constante o va y viene?',
        ask_quality_final: 'Puede describir la sensacion (por ejemplo: picazon, ardor, dolor agudo)?',
        no_symptoms: 'Entiendo. Si no hay sintomas activos, podemos pasar a una cita de rutina. Necesita ver al medico de inmediato o prefiere programar para despues? Que fecha le funciona mejor?'
      },
      fr: {
        ask_onset: 'Quand cela a-t-il commence ?',
        ask_quality_rash: 'Comment le decririez-vous : demangeaison, brulure ou douleur ?',
        ask_quality_pain: 'Comment decririez-vous la douleur : vive, sourde, pulsatile ou brulante ?',
        ask_quality_generic: 'Que ressentez-vous exactement ?',
        ask_severity: 'Sur une echelle de 1 a 10, quelle est l intensite ?',
        ask_timing: 'Est-ce constant ou intermittent ?',
        ask_quality_final: 'Pouvez-vous decrire la sensation (par ex. demangeaison, brulure, douleur vive) ?',
        no_symptoms: 'Compris. S il n y a pas de symptomes actifs, on peut passer a une visite de routine. Avez-vous besoin de voir un medecin immediatement, ou preferez-vous planifier plus tard ? Quelle date vous convient ?'
      },
      sw: {
        ask_onset: 'Ilianza lini?',
        ask_quality_rash: 'Inajisikiaje - kuwasha, kuungua, au maumivu?',
        ask_quality_pain: 'Unaweza kuelezea maumivu - makali, hafifu, yanadunda, au yanachoma?',
        ask_quality_generic: 'Inajisikiaje hasa?',
        ask_severity: 'Ukali wake ni kiasi gani kati ya 1 hadi 10?',
        ask_timing: 'Ni ya muda wote au inakuja na kuondoka?',
        ask_quality_final: 'Tafadhali elezea hisia unazopata (mfano: kuwasha, kuungua, maumivu makali).',
        no_symptoms: 'Sawa. Kama huna dalili za sasa, tunaweza kuendelea na miadi ya kawaida. Unahitaji kumuona daktari mara moja au ungependa kupanga miadi ya baadaye? Ni tarehe gani inakufaa?'
      }
    };
    return t[lang]?.[key] || fallback;
  };

  // Acknowledge what the user just described before asking the next question
  let ack = '';
  if (msg.includes('rash')) ack = 'Got it, you have a rash. ';
  else if (msg.includes('pain')) ack = "I hear you, you're in pain. ";
  else if (msg.includes('cough')) ack = 'Noted, you have a cough. ';
  else if (msg.includes('fever')) ack = 'I see, you have a fever. ';
  else if (msg.includes('headache')) ack = 'Understood, you have a headache. ';
  else if (msg.includes('tired') || msg.includes('fatigue')) ack = "I understand you're feeling tired. ";
  else if (msg.includes('stomach')) ack = 'Got it, stomach issues. ';

  const askOne = (question) => {
    const q = `${ack}${question}`.trim();
    if (isVoice) return `${q} Then I can check available times.${langHint}`;
    return `${q} Then I can check available times.${langHint}`;
  };

  if (isNoSymptoms || routineMode) {
    return i18n(
      'no_symptoms',
      "Understood. If you don't have active symptoms, we can switch to a routine visit. Do you need to see a doctor immediately, or would you like to schedule for later? What date works best for you?"
    );
  }

  const onsetMissing = !String(stored.onset || '').trim();
  const qualityMissing = !String(stored.quality || '').trim();
  const severityMissing = stored.severity === null || stored.severity === undefined || stored.severity === '';
  const timingMissing = !String(stored.timing || '').trim();

  if (errorCode === 'LOW_CONFIDENCE') {
    if (onsetMissing) return askOne(i18n('ask_onset', 'When did it start?'));
    if (qualityMissing) {
      if (msg.includes('rash')) return askOne(i18n('ask_quality_rash', 'How would you describe it - itchy, burning, or painful?'));
      if (msg.includes('pain')) return askOne(i18n('ask_quality_pain', 'How would you describe the pain - sharp, dull, throbbing, or burning?'));
      return askOne(i18n('ask_quality_generic', 'What does it feel like?'));
    }
    if (severityMissing) return askOne(i18n('ask_severity', 'How bad is it from 1 to 10?'));
    if (timingMissing) return askOne(i18n('ask_timing', 'Is it constant or does it come and go?'));
    return askOne(i18n('ask_quality_final', 'Can you describe what it feels like (for example: sharp, dull, burning)?'));
  }

  // TRIAGE_INCOMPLETE / TRIAGE_REQUIRED / other triage blockers
  if (onsetMissing) return askOne(i18n('ask_onset', 'When did it start?'));
  if (qualityMissing) {
    if (msg.includes('rash')) return askOne(i18n('ask_quality_rash', 'How would you describe it - itchy, burning, or painful?'));
    if (msg.includes('pain')) return askOne(i18n('ask_quality_pain', 'How would you describe the pain - sharp, dull, throbbing, or burning?'));
    return askOne(i18n('ask_quality_generic', 'What does it feel like?'));
  }
  if (severityMissing) return askOne(i18n('ask_severity', 'How bad is it from 1 to 10?'));
  if (timingMissing) return askOne(i18n('ask_timing', 'Is it constant or does it come and go?'));

  return askOne(i18n('ask_quality_final', 'Can you describe the quality of what you feel (for example: itchy, burning, sharp)?'));
}

function _sanitizeToolNameLeaks(text) {
  if (!text) return text;
  let s = String(text)
    .replace(/\brun_triage_rag\b/gi, 'triage')
    .replace(/\bget_available_slots\b/gi, 'available times')
    .replace(/\bschedule_appointment\b/gi, 'booking')
    .replace(/\bcollect_insurance\b/gi, 'insurance')
    .replace(/\bcreate_appointment_checkout\b/gi, 'checkout')
    .replace(
      /a secure payment form will appear above where you can enter your card details to complete the purchase\.?/gi,
      'I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
    )
    .replace(
      /a secure payment form will appear above[^.]*\./gi,
      'I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
    )
    .replace(
      /your secure payment form should appear now\.?/gi,
      'I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
    );
  const looksLikeCheckoutHandoff =
    /(order summary|order is ready|secure payment page|taken to .*secure payment|complete your purchase|enter your card details)/i.test(
      s
    );
  const mentionsVerification = /(verification code|6-?digit code|verify your email)/i.test(s);
  if (looksLikeCheckoutHandoff && !mentionsVerification) {
    s += ' Before payment, please enter the 6-digit verification code we emailed you.';
  }
  return s;
}

function _sanitizeSuggestedNextStep(text) {
  if (!text) return text;
  let s = _sanitizeToolNameLeaks(text);
  // Remove any trailing instructions that still look like tool orchestration.
  s = s.replace(/then call .*$/i, '');
  s = s.replace(/before looking up slots.*$/i, '');
  s = s.replace(/before booking.*$/i, '');
  return s.trim();
}

function _sanitizeToolMessageForPatient(text) {
  // Keep the helpful intent but strip internal tool names.
  const s = _sanitizeToolNameLeaks(text);
  // Normalize common orchestration patterns to human language.
  if (/triage is not complete|triage is incomplete|until triage/i.test(s)) {
    return 'I just need one bit more to finish triage, then I can check times.';
  }
  if (/triage_reopen|new or changed symptoms|new symptoms were flagged/i.test(s)) {
    return 'Let me ask a few quick questions about what you are feeling now, then I can continue with booking.';
  }
  if (/rag confidence is low|low confidence/i.test(s)) {
    return 'I just need one more detail to route you safely.';
  }
  return s;
}

async function _findNextAvailableDate(startDate, clinicId, appointmentType, lane, sessionId, patientId, callerPhone, channel) {
  const d = new Date(String(startDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10));
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    const dateStr = d.toISOString().slice(0, 10);
    const slotOut = await KellyToolExecutor.execute(
      'get_available_slots',
      { date: dateStr, appointment_type: appointmentType, lane, force_after_clarified: true },
      { sessionId, clinicId, patientId, callerPhone, channel }
    );
    const source = Array.isArray(slotOut?.slot_bundles) && slotOut.slot_bundles.length
      ? slotOut.slot_bundles
      : (Array.isArray(slotOut?.available_slots) ? slotOut.available_slots : []);
    if (slotOut?.success && source.length) {
      return { date: dateStr, slotOut };
    }
  }
  return null;
}

function _extractRequestedSpecialty(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('dermatology') || t.includes('skin specialist')) return 'Dermatology';
  if (t.includes('urology') || t.includes('urologist')) return 'Urology';
  if (t.includes('primary care') || t.includes('pcp')) return 'PrimaryCare';
  if (t.includes('cardiology') || t.includes('cardiologist') || t.includes('heart specialist')) return 'Cardiology';
  return null;
}

function _looksLikeSlotChoice(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (t === 'async' || t === 'sync') return true;
  if (/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(t)) return true;
  if (/\bfirst available\b/.test(t)) return true;
  if (/\boption\s*\d+\b/i.test(t)) return true;
  return false;
}

function _extractInsuranceMemberId(text) {
  const t = String(text || '');
  return t.match(/member\s*(id)?\s*[:#]?\s*([a-z0-9-]{6,})/i)?.[2] || null;
}

function _extractEmail(text) {
  const t = String(text || '');
  return t.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)?.[0] || null;
}

function _extractPhone(text) {
  const t = String(text || '');
  return t.match(/\+?\d[\d\s().-]{7,}\d/)?.[0] || null;
}

function _maskPhoneTail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function _extractPatientName(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tagged = t.match(/name\s*:\s*([A-Za-z][A-Za-z'\- ]{1,80})/i)?.[1]?.trim();
  if (tagged) return tagged;
  const intro = t.match(/\b(i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  if (intro?.[2]) return intro[2];
  // Standalone 2–4 word title-cased string (e.g. "Jeremiah Richard")
  const words = t.split(/\s+/).filter(w => !/^(name|email|phone|number|and|the|my|i'm|im|is)$/i.test(w));
  if (words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Za-z'-]+$/.test(w)) && !t.includes('@') && !/\d{3,}/.test(t)) {
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  return null;
}

function _extractCollectedBookingInfo(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let name = null, email = null, phone = null;
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRe = /\+?1?[\s\-.]*\(?[0-9]{3}\)?[\s\-.]*[0-9]{3}[\s\-.]*[0-9]{4}\b/g;

  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const content = (m?.content || '').toString().trim();
    if (!content || m.role !== 'user') continue;

    const emails = content.match(emailRe);
    if (emails && emails.length) email = emails[emails.length - 1];

    const phones = content.match(phoneRe);
    if (phones && phones.length) {
      const p = phones[phones.length - 1].replace(/\D/g, '');
      if (p.length >= 10) phone = p.length === 10 ? `+1${p}` : `+${p}`;
    }

    const withoutEmailAndPhone = content.replace(emailRe, '').replace(phoneRe, '');
    const namePart = withoutEmailAndPhone.replace(/\s*(?:name|email|phone|number)\s*$/gi, '').replace(/^[&\-,\s]+|[&\-,\s]+$/g, '').trim();
    if (namePart) {
      const words = namePart.split(/\s+/).filter(w => !/^(name|email|phone|number|and|the|my|i'm|im|is)$/i.test(w));
      if (words.length >= 2 && words.length <= 5 && words.every(w => /^[A-Za-z'-]+$/.test(w))) {
        name = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }
    }
  }
  if (name && email && phone) return { name, email, phone };
  return null;
}

function _parseSlotOrdinal(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  const num = t.match(/\boption\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:one|option|slot)?\b/);
  if (num) {
    const n = parseInt(num[1] || num[2], 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  const ordinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  for (const [word, n] of Object.entries(ordinals)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return n;
  }
  return null;
}

function _parseTimeLikeFromText(text) {
  const t = String(text || '').toLowerCase().trim();
  const m24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) return `${m24[1].padStart(2, '0')}:${m24[2]}`;
  const m12WithMinutes = t.match(/\b(1[0-2]|0?[1-9])[.:]([0-5]\d)\s*(am|pm)\b/);
  if (m12WithMinutes) {
    let h = parseInt(m12WithMinutes[1], 10);
    const min = parseInt(m12WithMinutes[2], 10);
    const ampm = m12WithMinutes[3];
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  const m12 = t.match(/\b(1[0-2]|0?[1-9])\s*(am|pm)\b/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const ampm = m12[2];
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

function _normalizeTimeString(text) {
  const parsed = _parseTimeLikeFromText(text);
  return parsed || String(text || '').trim().toLowerCase();
}

function _resolveSlotBundleFromUserMessage(bundles, userMessage) {
  const arr = Array.isArray(bundles) ? bundles : [];
  if (!arr.length) return null;
  const msg = String(userMessage || '').trim().toLowerCase();
  if (!msg) return null;

  const ordinal = _parseSlotOrdinal(msg);
  if (ordinal && arr[ordinal - 1]) return arr[ordinal - 1];

  const msgTime = _parseTimeLikeFromText(msg);
  if (msgTime) {
    const byTime = arr.find((s) => {
      const candidates = [s?.time, s?.start_time, s?.start, s?.display];
      return candidates.some((c) => _normalizeTimeString(c) === msgTime);
    });
    if (byTime) return byTime;
  }

  const byLabel = arr.find((s) => {
    const label = String(s?.display || s?.time || s?.start_time || s?.start || '').toLowerCase();
    return label && (msg.includes(label) || label.includes(msg));
  });
  if (byLabel) return byLabel;

  if (/\b(that works|that one|works for me|sounds good|book it|yes)\b/.test(msg)) {
    return arr[0];
  }
  return null;
}

function _extractPayerName(text) {
  const t = String(text || '');
  const tagged = t.match(/payer\s*[:#]?\s*([A-Za-z][A-Za-z0-9 &.-]{1,80})/i)?.[1]?.trim();
  if (tagged) return tagged;
  // Common payers quick match
  const common = ['Aetna', 'Cigna', 'UnitedHealthcare', 'UHC', 'Blue Cross', 'Blue Shield', 'BCBS', 'Humana', 'Kaiser'];
  const lc = t.toLowerCase();
  const hit = common.find((p) => lc.includes(p.toLowerCase()));
  return hit || null;
}

// ─────────────────────────────────────────────────────────────
// Fast intent classifier — runs before LLM, no token cost
// ─────────────────────────────────────────────────────────────
const BILLING_KEYWORDS = [
  'receipt', 'invoice', 'bill', 'billing', 'payment', 'charge',
  'refund', 'insurance card', 'claims', 'claim status', 'eob',
  'explanation of benefits', 'how much does', 'what does it cost',
  'what is the price', 'pricing', 'copay', 'deductible'
];

const ROUTINE_BOOKING_KEYWORDS = [
  'annual physical', 'annual check', 'wellness visit', 'routine physical',
  'routine check', 'general visit', 'general check', 'yearly physical',
  'wellness check', 'routine visit', 'annual exam', 'regular checkup',
  'just a checkup', 'just a check-up', 'prescription refill', 'refill my prescription',
  'no symptoms', "don't have symptoms", 'do not have symptoms', 'without symptoms',
  'no pain', 'just routine', 'preventive visit',
  'нет симптомов', 'без симптомов', 'только осмотр', 'профилактический осмотр'
];

const SYMPTOM_KEYWORDS = [
  'pain', 'hurt', 'ache', 'rash', 'fever', 'cough', 'nausea', 'vomit',
  'dizzy', 'bleed', 'swollen', 'swelling', 'tired', 'fatigue', 'shortness',
  'breath', 'chest', 'headache', 'stomach', 'sore', 'burning', 'itching',
  'discharge', 'lump', 'bump', 'infection', 'sick', 'ill', 'not feeling well',
  'feeling bad', 'something wrong', 'worried about'
];
const STEP1_NOISE_PENALTY_THRESHOLD = Number(process.env.STEP1_NOISE_PENALTY_THRESHOLD || 0.2);

function _classifyIntent(message) {
  const t = String(message || '').toLowerCase();
  if (BILLING_KEYWORDS.some(k => t.includes(k))) return 'billing';
  if (ROUTINE_BOOKING_KEYWORDS.some(k => t.includes(k))) return 'routine_booking';
  if (SYMPTOM_KEYWORDS.some(k => t.includes(k))) return 'symptom';
  return 'unknown';
}

function _extractLikelySymptomFromText(message) {
  const t = String(message || '').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  for (const k of SYMPTOM_KEYWORDS) {
    if (lower.includes(k)) return k;
  }
  return t.split(/\s+/).slice(0, 5).join(' ');
}

function _noisyConfirmPrompt(preferredLanguage, extractedSymptom) {
  const symptom = String(extractedSymptom || 'that symptom').trim();
  const lang = String(preferredLanguage || 'en').toLowerCase().split('-')[0];
  const map = {
    en: `Just to be sure I got that right, you mentioned ${symptom}. Is that correct?`,
    fr: `Pour confirmer, vous avez mentionne ${symptom}. C est bien ca ?`,
    sw: `Nihakikishe nimekusikia sawa, umetaja ${symptom}. Je, ni sahihi?`,
    ru: `Чтобы подтвердить, вы упомянули ${symptom}. Это верно?`
  };
  return map[lang] || map.en;
}

function _hasNoSymptomsRoutineSignal(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\b(no symptoms?|without symptoms?|don't have symptoms?|do not have symptoms?|just routine|routine|routine visit|routine check(?:-?up)?|annual check|checkup|check-up)\b/i.test(t) ||
    /\b(нет симптом|без симптом|только осмотр|профилактическ)\b/i.test(t)
  );
}

function _hasGeneralVisitSignal(text) {
  const t = String(text || '').toLowerCase();
  return /\b(general visit|general check|routine visit|wellness visit|checkup|check-up)\b/i.test(t);
}

function _isNoSymptomsReply(text) {
  const t = String(text || '').trim().toLowerCase();

  // Exact matches including common typos
  const exactMatches = [
    'no', 'none', 'nope', 'nah', 'non', 'non3', 'noo', 'noe', 'nom',
    'nil', 'nill', 'zero', 'nothing', 'none at all',
    'нет', 'неа', 'ningependa hapana', 'hapana'
  ];
  if (exactMatches.includes(t)) return true;

  // Fuzzy: short reply that starts with "no" and has at most 2 extra chars (covers non3, noo, noe, etc.)
  if (/^no.{0,2}$/i.test(t) && t.length <= 5) return true;

  // Phrase patterns
  return (
    /\b(no symptoms?|without symptoms?|no concerns?|nothing right now|none|non[e3]?)\b/i.test(t) ||
    /\b(routine|routine check(?:-?up)?|routine visit|just a checkup|checkup only|check-up only)\b/i.test(t) ||
    /\b(i (don'?t|do not) have (any )?symptoms?)\b/i.test(t) ||
    /\b(нет симптом|без симптом|жалоб нет)\b/i.test(t)
  );
}

function _isRoutineLockedForSession(sessionId, history = []) {
  try {
    if (KellyToolExecutor._routineNoSymptomsEffective?.(sessionId)) return true;
  } catch (_) {}
  try {
    if (KellyToolExecutor._triageRowHasConcernOrOnsetStored?.(sessionId)) return false;
    const corpus = (Array.isArray(history) ? history : [])
      .filter((m) => m?.role === 'user')
      .map((m) => String(m?.content || '').toLowerCase())
      .join('\n');
    return _hasNoSymptomsRoutineSignal(corpus);
  } catch (_) {
    return false;
  }
}

function _extractUrgencyFromText(text) {
  const t = String(text || '').toLowerCase();
  // Avoid classifying duration phrases like "for months now" as urgent.
  if (/\b(immediately|urgent|asap|right away|right now|today|emergency)\b/i.test(t)) return 'sync';
  if (/\b(schedule for later|schedule later|later|not urgent|tomorrow|next week|whenever|no rush)\b/i.test(t)) return 'async';
  return null;
}

function _extractPreferredDateToken(text) {
  const t = String(text || '').toLowerCase();
  const explicit = t.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i);
  if (explicit) return explicit[1];
  if (/\btomorrow\b/i.test(t)) return 'tomorrow';
  if (/\btoday\b/i.test(t)) return 'today';
  return null;
}

function _resolvePreferredDateFromMeta(preferredDate, clinicId) {
  const raw = String(preferredDate || '').trim().toLowerCase();
  const d = new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return KellyToolExecutor._normalizeToBusinessDate(raw, clinicId);
  }
  const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const year = new Date().getFullYear();
    const mm = String(Math.max(1, Math.min(12, parseInt(md[1], 10)))).padStart(2, '0');
    const dd = String(Math.max(1, Math.min(31, parseInt(md[2], 10)))).padStart(2, '0');
    return KellyToolExecutor._normalizeToBusinessDate(`${year}-${mm}-${dd}`, clinicId);
  }
  if (raw === 'tomorrow') d.setDate(d.getDate() + 1);
  if (raw === 'today') d.setDate(d.getDate());
  // business-day normalization to keep weekday behavior consistent
  return KellyToolExecutor._normalizeToBusinessDate(d.toISOString().slice(0, 10), clinicId);
}

function _historyShowsSlotChosen(history = []) {
  const corpus = (Array.isArray(history) ? history : [])
    .map((m) => String(m?.content || '').toLowerCase())
    .join('\n');
  const timeLike = /\b(\d{1,2}[:.]\d{2}\s?(am|pm)?)\b/i.test(corpus);
  const chooseLike = /\b(i'?ll pick|i pick|choose|selected|that works|works for me|works|book (that|it)|confirm (that|it)|that one|sounds good|book me|i('ll| will) take)\b/i.test(corpus);
  const assistantConfirmed = /\b(i('ll| will) book you|booked you for|your appointment is|confirmed for)\b/i.test(corpus);
  return (timeLike && chooseLike) || assistantConfirmed;
}

function _isBookingProgressIntent(text) {
  const t = String(text || '').toLowerCase();
  const explicitProgress =
    /\b(proceed to checkout|payment link|verification code|available slot|available time|first available|continue the booking flow|continue booking|pick a (time|slot)|choose a (time|slot))\b/i.test(t) ||
    /\bcheckout\b/i.test(t);
  if (explicitProgress) return true;
  if (SYMPTOM_KEYWORDS.some((k) => t.includes(k))) return false;
  const wordCount = t.trim().split(/\s+/).filter(Boolean).length;
  return (
    wordCount < 15 &&
    /\b(book|booking|appointment|available slot|available time|first available)\b/.test(t)
  );
}

function _triageLockedForRerag(sessionId) {
  try {
    const KellyToolExecutor = require('../kelly-tool-executor');
    return KellyToolExecutor._triageLockedForRerag(sessionId);
  } catch (_) {
    return false;
  }
}

function _resolveAppointmentTypeForSession(sessionId, sessionRow, matched, fallback = 'General Consult') {
  const TriageRAGService = require('../../clinical/triage-rag-service');
  return (
    matched?.appointment_type ||
    sessionRow?.target_specialty ||
    TriageRAGService.getAuthoritativeForSession(sessionId)?.target_specialty ||
    fallback
  );
}

function _markSlotsPresentedForSession(sessionId, slotOut) {
  if (!sessionId || !slotOut?.success) return;
  try {
    const KellyToolExecutor = require('../kelly-tool-executor');
    const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
    const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
    if (!bundles.length && !available.length) return;
    KellyToolExecutor._setSessionMeta(sessionId, 'slot_presented', '1');
    if (bundles.length) {
      KellyToolExecutor._setSessionMeta(sessionId, 'last_slot_bundles', JSON.stringify(bundles.slice(0, 12)));
    }
  } catch (_) {}
}

function _getBillingReply(message) {
  const t = String(message || '').toLowerCase();
  if (t.includes('receipt')) return 'I can help you with your receipt. Could you share the email address associated with your appointment so I can look that up?';
  if (t.includes('claim')) return 'I can look into your insurance claim. Could you share your member ID and the date of service?';
  if (t.includes('refund')) return 'I can help with a refund question. Can you tell me which appointment or charge this is about?';
  if (t.includes('copay') || t.includes('deductible')) return "I can check your coverage details. What's your insurance member ID?";
  return 'I can help with your billing question. Can you give me a bit more detail about what you need — for example, a receipt, a claim, or a charge on your account?';
}

function _isPayNowIntent(message) {
  const t = String(message || '').toLowerCase();
  return /\b(pay (the )?copay|pay now|send (me )?(a )?(secure )?payment link|pay before (the )?appointment|secure pay link|pay with card)\b/i.test(t);
}

// Truncate tool payloads that get embedded into the next Groq request.
// run_triage_rag responses can include long SOAP notes and context, which
// contributes to TPM overages.
// Tool payloads are echoed back into the next Groq request. When conversations loop,
// these payloads can push the request over Groq's hard size limit (HTTP 413).
// Lower defaults so the retry path has a better chance of succeeding.
const KELLY_TOOL_RESULT_MAX_CHARS_VOICE = parseInt(process.env.KELLY_TOOL_RESULT_MAX_CHARS_VOICE || '900', 10);
const KELLY_TOOL_RESULT_MAX_CHARS_CHAT = parseInt(process.env.KELLY_TOOL_RESULT_MAX_CHARS_CHAT || '1200', 10);

// Max tool call iterations per turn (prevents infinite loops)
// Default 6 to reduce Groq TPM / 429 pressure (each iteration can add LLM + tools). Override: KELLY_MAX_TOOL_ITERATIONS.
const MAX_TOOL_ITERATIONS = parseInt(process.env.KELLY_MAX_TOOL_ITERATIONS || '6', 10);

// Token budget: lower defaults reduce Groq TPM errors while still allowing tool calling.
const KELLY_VOICE_MAX_TOKENS = parseInt(process.env.KELLY_VOICE_MAX_TOKENS || '200', 10);
const KELLY_CHAT_MAX_TOKENS = parseInt(process.env.KELLY_CHAT_MAX_TOKENS || '300', 10);

// ─────────────────────────────────────────────────────────────
// Kelly system prompt (the full medical-assistant persona)
// Rebuilt each turn on purpose: context.kellyScriptHint and date strings change; caching would be unsafe.
// When KELLY_PHASE_PROMPTS=1, ROUTINE_INTAKE / ROUTINE_FOLLOWUP use kelly-prompt-builder; other phases still use this.
// ─────────────────────────────────────────────────────────────
function _buildSystemPromptLegacy(context) {
  const { channel, clinicId, patientName, preferredLanguage, kellyScriptHint, orchestration } = context;
  const isVoice = channel === 'voice';
  const todayIso = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getUTCFullYear();

  const orchestrationBlock =
    KellyOrchestratorPhase.orchestratorEnabled() && orchestration
      ? `\n${KellyOrchestratorPhase.buildOrchestrationPromptSection(orchestration)}\n`
      : '';

  return `You are Kelly, a warm and empathetic medical voice assistant for Somo.
${orchestrationBlock}
## Your Role
You help patients:
- Check insurance coverage and benefits
- Book physician appointments with the right specialist
- Manage payments through insurance and copays
- Answer questions about medical claims and billing
- Triage symptoms to route patients to the right specialist

## Date/Year Accuracy
- Today's date is ${todayIso} (year ${currentYear}).
- If the patient gives month/day without a year, assume ${currentYear}.
- Do not mention a past year unless the patient explicitly said it or a tool returned it.

## Greeting Policy (VERY IMPORTANT)
- First turn greeting must be short and natural: one sentence like "Hi, I'm Kelly. How can I help today?"
- Do NOT enumerate language lists in greeting.
- Do NOT include emergency disclaimers in normal greeting unless the patient reports red-flag symptoms.
- On subsequent turns, do NOT repeat the greeting. Continue directly with triage questions or next steps.
- When triage is incomplete, ask exactly ONE OPQRST field per turn (start with onset).

## Language
- CRITICAL: Detect the patient's language in the first 1-2 messages and respond in that language for the entire conversation.
- If they write in Spanish, respond in Spanish. Swahili → Swahili. French → French. Never switch back to English unless they ask.
- If they say "nataka kuongea na daktari" (I want to talk to a doctor in Swahili), respond in Swahili and route them to booking.
${patientName ? `- The patient's name is ${patientName}. Use it naturally.` : ''}

## Multilingual Symptom Triggers (Triage Required)
Treat any of these as symptom/medical-concern triggers (not “routine booking”), and run OPQRST + run_triage_rag before slots:
- Spanish examples: "me duele", "tengo dolor", "tengo fiebre", "me falta el aire", "tengo náuseas"
- Swahili examples: "maumivu", "inauma", "homa", "kikohozi", "kushindwa kupumua", "kichefuchefu"
- If you detect symptom language in the caller’s language, do NOT skip triage.

## Triage Trigger Rules (Hard Policy)
- If the patient reports ANY symptom or medical concern (including when they say "I just want to book" or "general visit"), you MUST collect OPQRST and call run_triage_rag before calling get_available_slots.
- Only skip triage for clearly routine/annual/admin visits with NO current symptom or medical concern.

## Conversation State Machine (Tool Ordering)
You MUST follow these states for every conversation:

### State A: Pre-triage
- Allowed tools: get_triage_session, store_triage_opqrst, store_triage_rich_intake, request_document_upload, query_patient_records (records Q&A only), run_triage_rag, search_medical_literature (evidence only), find_clinic_specialists (verified directory; phone rules in tool result).
- Forbidden tools: get_available_slots, schedule_appointment, create_appointment_checkout, verify_checkout_code.

### State B: Triage-in-progress
- Allowed tools: store_triage_opqrst, store_triage_rich_intake, get_triage_session, run_triage_rag, request_document_upload, search_medical_literature, find_clinic_specialists.
- Forbidden tools: get_available_slots, schedule_appointment, create_appointment_checkout, verify_checkout_code.

### State C: Triage-complete
- Allowed tools: get_available_slots → schedule_appointment → create_appointment_checkout → verify_checkout_code; also search_medical_literature, find_clinic_specialists when helpful.
- Hard rule: do NOT call get_available_slots or schedule_appointment until triage is complete (OPQRST + run_triage_rag done, and rag_confidence is not low).

### Safety override
- If emergency protocol triggers (detectRedFlags or safety_screen), you MUST stop and you MUST NOT call any scheduling/slot/payment tools.

## History of Present Illness (HPI) — OPQRST (W1-S1.5)
You MUST complete triage BEFORE calling get_available_slots. Collect OPQRST in order:
1. **Onset**: "When did this start?"
2. **Provocation/Palliation**: Ask what makes symptoms better or worse when relevant to the complaint (optional unless clinic triage_policy is required).
3. **Quality**: "Can you describe what it feels like? (sharp, dull, pressure, burning...)"
4. **Radiation**: "Does it spread anywhere?" (SKIP for mental health — see Psychiatry below)
5. **Severity**: "On a scale of 1 to 10, how bad is it?" — If ≥8, route as urgent.
6. **Timing**: "Is it constant or does it come and go?"
Store each answer via store_triage_opqrst immediately — do not wait.

## Past Medical History (PMH) — Prior to specialty deep-dive
- **Prior diagnoses**: "Do you have any known conditions?" (e.g. diabetes, hypertension)
- **Prior workups**: "Have you had any recent tests? ECG, labs, imaging?"
- **Surgeries**: Note any relevant prior procedures when pertinent to chief complaint.

## Meds + Allergies (non-negotiable)
"Are you on any medications?" — Critical for differential (e.g. antipsychotic → medication-induced hyperprolactinemia). Always ask.
"Any drug or food allergies?" — Non-negotiable before routing. Collect now; store later via store_triage_rich_intake.

## Family History (FHx) / Social History (SHx) — collect AFTER specialty deep-dive
- **Cardiology**: "Any family history of heart disease or heart attack before 60?"
- **Oncology**: FHx colon, breast, prostate cancer when relevant.
- **Hepatology/Psychiatry**: CAGE-4 alcohol screen — see below. Collect (0–4); ≥2 = positive, then store later via store_triage_rich_intake.

## Specialty-Specific Deep-Dive (W1-S1.6, W1-S1.7)
**CRITICAL:** After you collect OPQRST + medications + known conditions + allergies, make a first run_triage_rag call to identify the most likely specialty. Then ask specialty-specific deep-dive questions. If any answers belong in OPQRST, store them via store_triage_opqrst. After that, collect family/social history (incl. alcohol/smoking/occupation), call store_triage_rich_intake, then call run_triage_rag again with full combined context.
- **Hepatology/GI**: Alcohol use? Meds/supplements? Prior liver tests (ALT, AST, ultrasound)?
- **Cardiology**: Family heart disease? Prior ECG/echo? Current cardiac meds?
- **Dermatology**: How long? Spreading? New skincare products or exposures?
- **Psychiatry**: PHQ-2, GAD-2, safety screen (see below). Prior meds, therapy, psychiatrist.
- **Orthopedics**: Mechanism of injury? Prior treatment for this?

## Async vs Sync (UX)
When discussing visit types: **async review** = patient uploads photos/info for a specialist to review later (no live video). **Sync** = live video visit at a scheduled time. Follow triage severity and lane rules (e.g. high urgency → sync).

## Mental Health Intake (gap8) — NOT OPQRST Radiation
For mood, anxiety, depression, PTSD, ADHD, bipolar: Do NOT ask "does it spread anywhere."
- **PHQ-2**: "Over the last 2 weeks, have you felt little interest or pleasure? Down, depressed, or hopeless?"
- **GAD-2**: "Over the last 2 weeks, have you felt nervous or on edge? Unable to stop worrying?"
- Prior treatment: meds, therapy, psychiatrist.

## OPQRST Adaptation for Non-Pain Complaints (T16)
When the complaint is NOT classic pain (e.g. rash/skin, fatigue/endocrine, respiratory, psychiatry), adapt the OPQRST fields like this:
- Rashes: severity = itch/extent; provocation = new products/exposures.
- Fatigue: severity = function impact; quality = tiredness vs weakness.
- Respiratory: severity = breathing limit; quality = dry/wheezy/wet cough.
- Psychiatry: severity = distress; run Safety Screen; skip "does it spread."

## Safety Screen — Columbia Protocol (M-S1.C)
For mental health OR when RAG suggests psychiatry: Ask these 2 questions. Store yes/no via safety_screen_q1, safety_screen_q2.
1. "In the past month, have you wished you were dead?"
2. "Have you had thoughts of killing yourself?"
If either is YES → safety_screen = "positive". This overrides routing: treat as safety_level red. Say: "Thank you for sharing that. Your safety matters. Please call 988 (Suicide & Crisis Lifeline) or go to your nearest emergency room. I'm not able to provide crisis care, but they can help right away."

## Emergency Protocol
If ANY of these are present → IMMEDIATELY say: "This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now." Then stop and do not continue with booking.
- Crushing chest pain or pressure
- Difficulty breathing (severe)
- Sudden weakness, face drooping, speech problems (stroke signs)
- Suicidal thoughts or intent
- Severe allergic reaction / throat swelling
- Active seizure or unconscious person
- Overdose

Safety precedence: once emergency protocol triggers, you MUST NOT call get_available_slots or schedule_appointment (or any insurance/payment tools) for the rest of the conversation.

## Mixed-Intent Ordering (T17)
For any symptomatic case:
- Finish triage (run_triage_rag and any required deep-dive + critical_unknowns follow-ups) before booking.
- If the patient asks about booking/insurance while triage is incomplete, prioritize safety/triage first.
- Intent precedence: safety/emergency → triage → booking → insurance → billing.

## Specialist Routing
After triage, use the RAG tools to determine the right specialty — DO NOT ask the patient "which specialist do you want?" They don't know. You figure it out from symptoms.
When run_triage_rag returns secondary_specialties (2+ differentials point to different specialists), the patient_friendly_summary will say "you may need both X and Y". Say that to the patient and ask which they'd like to book first.
- If secondary_specialties is non-empty, default to booking the primary specialty first, and offer the secondary specialty as an optional additional review after the primary visit.
- After the patient responds with the specialty to book first (e.g. "Dermatology first", the specialty name, or "book the first one"), call get_available_slots immediately for that chosen specialty and do NOT repeat the specialty-choice question.
- Chest/heart symptoms → Cardiology
- Skin rashes, lesions → Dermatology
- Mental health, mood, anxiety → Psychiatry
- Bone/joint/back → Orthopedics
- Headache, seizure, numbness → Neurology
- Breathing, cough → Pulmonology
- General/routine → Primary Care

## Document/Image Upload
Rash/ECG/lab/image mentioned → request_document_upload, pause until upload. Check get_triage_session: media_received=1 → continue OPQRST/run_triage_rag; 0 → request again. After upload, run_triage_rag with full context. Voice: "I'll send a link."

## Patient Records (M-Doc.3)
When the patient asks about their own records — "explain my labs", "what did my last visit say", "what do my results mean", "what did the doctor find" — call query_patient_records with their question. This searches their uploaded documents and returns a patient-friendly answer. If they have no documents yet, explain they can upload and ask again.

Hard rule: query_patient_records is ONLY for Q&A about existing labs/last visits. Never use it to handle a new complaint with symptoms; new complaints must go through OPQRST + run_triage_rag first.

## Urgency Framing (Patient-Facing)
Internally lanes are async/sync, but NEVER ask callers "async or sync."
Ask in patient terms: "Do you need to see a doctor immediately, or do you want to schedule for later?"
Map "immediately/urgent/now" -> sync. Map "scheduled/later/not urgent" -> async.

## Booking Flow — Contact Collection (voice and chat)
1. Collect patient name (if not known)
2. Complete triage with run_triage_rag first
3. Find available slots with get_available_slots (MUST run triage first; pass specialty from run_triage_rag)
4. If kelly_script is in the slot result, say it to the patient
5. If secondary_specialties, offer optional additional review (ask which they want)
6. Confirm the slot with the patient
7. Ask for ONE piece of contact info at a time in this order:
   - If name is unknown: "Can I get your full name?"
   - Once name is known, ask: "What's the best email address for your confirmation?"
     (Voice: let them spell it out, confirm back: "I have [email], is that correct?")
   - Once email is confirmed, ask: "And your phone number?"
8. As soon as you have name + email + phone, call schedule_appointment IMMEDIATELY.
   Do NOT ask for anything else first. Do NOT summarize. Just call the tool.
   The server will fill in any missing fields from what was collected earlier in the session.
9. After schedule_appointment returns { success: true }, THEN confirm the booking to the patient.
10. create_appointment_checkout → verify_checkout_code for payment

## Routine Visit Constraints
- If caller says routine/general visit with NO symptoms, default specialty is Primary Care unless caller explicitly asks for another specialty.
- Do not invent doctor names or specialties. Only use provider/specialty values returned by tools.
- Do not claim a specific doctor is booked until schedule_appointment returns success.

## gap12: Before run_triage_rag — assemble OPQRST from session
Call get_triage_session first. Merge stored onset, provocation, quality, radiation, severity, timing, associated_sx with what the patient just said. For the first run_triage_rag pass, also pass the medications/known conditions/allergies you collected in this step (even before you call store_triage_rich_intake). For the second pass (after store_triage_rich_intake), include full rich intake from session + any new clarifications.

Session continuity rule (resume): if the conversation is resuming, you MUST summarize what you already stored (OPQRST + rich intake) and ask ONLY for missing pieces before calling run_triage_rag again.

## critical_unknowns (M-S1.D)
When run_triage_rag returns critical_unknowns (e.g. "alcohol history", "CAGE not done"), ask those questions before routing. Store answers via store_triage_opqrst, then call run_triage_rag again with full history.

## gap13: Low RAG confidence
If run_triage_rag returns rag_confidence < rag_confidence_threshold, ask ONE more clarifying question (one OPQRST field) before routing. Do not proceed to get_available_slots until confidence is >= rag_confidence_threshold or the patient has no more to add.
Examples:
- Back pain: "When did the back pain start?"
- Burning rash/skin: "What does it feel like (itching or burning)?"
- Shortness of breath: "Is it constant or does it come and go?"

## Rules
- Never collect card numbers over phone/chat
- Always confirm insurance before booking
- Name, email, and phone are ALL required before calling schedule_appointment — never skip any of them
- When the user provides their phone number (after you asked for it), you have all three—call schedule_appointment immediately. Never re-ask for email or name if you already collected them in prior turns. Do NOT say "that looks like a phone number, I still need your email"—if you asked for phone and they gave a number, you have it; proceed to book
- If schedule_appointment returns requiresPhone, ask for phone then retry with the SAME name and email—do NOT re-ask for name or email
- Never say "I've booked it" until schedule_appointment returns success
- NEVER say you've booked, confirmed, or scheduled an appointment until schedule_appointment returns { success: true }.
- NEVER invent practitioner names, doctor names, or specialties. Only use provider names and specialties from tool output.
- NEVER invent or assume a provider name. If slot_bundles returns practitioner_name: null, say "a provider" or "a doctor" and never a specific name.
- NEVER say "Dr. [name]" unless that exact name appeared in a tool result in this conversation.
- Be empathetic. Healthcare is stressful.

## Slot Lookup Rules
- Call get_available_slots for ONE date per turn. If no slots are available, ask the patient for another date.
- Once slots are found, present them and wait for a user choice. Do not automatically fetch additional dates in the same turn.
- **Slot selection (CRITICAL)**: When the user selects a slot (e.g. "option 7", "option 1", "7", "5:00 PM", "the first one"), treat it as a FINAL choice. Immediately ask for name, email, and phone to complete the booking. Do NOT re-list the slots, do NOT ask "Does that work for you?" or "Would that work?" — that adds a pointless extra turn. Go straight to: "To complete your booking, I'll need your full name, email, and phone number."

${isVoice ? '## Voice Format\nKeep all replies SHORT. Max 2 sentences per turn. No bullet points. No headers. Just natural speech.' : '## Chat Format\nYou can use slightly longer replies. Bullet points OK when listing options. Keep it conversational.'}

${KellyAgentService._languageDirective(preferredLanguage)}
${kellyScriptHint ? `## Recent Specialist Routing Context\nWhen presenting availability this turn, preserve this exact routing note before slot options: "${kellyScriptHint}"` : ''}
`;
}

function buildCommerceCheckoutSystemPrompt(ctx) {
  const productId = String(ctx?.productId || '').trim();
  const providerId = String(ctx?.providerId || '').trim();
  const patientEmail = ctx?.patientEmail ? String(ctx.patientEmail).trim() : '';
  const lang = KellyAgentService._languageDirective(ctx?.preferredLanguage);
  return `You are Kelly, helping a patient complete a secure retail product purchase from their clinic's shop.
## Locked context (do not claim a different product or merchant)
- product_id: ${productId}
- provider_id (merchant): ${providerId}
${patientEmail ? `- Patient email on file (use for prepare_commerce_checkout if they confirm): ${patientEmail}` : ''}

## Guest checkout (no app login)
- This flow does **not** require a patient portal login. Do not ask users to sign in before paying.
- After a successful purchase, you may briefly mention they can optionally create an account or use the app to track orders — never block checkout on account creation.

## Default journey (STRICT ORDER — do not skip or reorder steps)
1. **Discover** — Answer product and ingredient questions; call get_product_quote before stating any price.
2. **Cart** — When customer wants to buy: call add_to_cart, then get_cart to confirm. Ask "Anything else before checkout?"
3. **Collect email** — Ask for email. As soon as it is provided, call send_commerce_verification_code(email).
4. **Verify email** — Tell customer "I sent a 6-digit code to [email]. Please share it when you receive it."
   - When they provide the code, call verify_commerce_code(email, code).
   - If verification fails, offer to resend.
5. **Collect + save shipping** — After email is verified, ask for full delivery address.
   - As soon as address is provided, call save_shipping_address() with structured fields.
   - If the customer gives a full address string, extract: line1, city, state, postal_code.
   - NEVER skip this step. NEVER pass address as a string arg to prepare_commerce_checkout.
   - If save_shipping_address returns incomplete_address, ask for missing fields only.
6. **Prepare checkout** — Only after BOTH verify_commerce_code AND save_shipping_address return success:
   - Call prepare_commerce_checkout(customer_email, use_cart: true).
7. **Confirm** — Summarize next steps only (secure payment UI/link). Do not claim payment is complete in chat.

## Buy intent (critical)
- Phrases like "buy", "I'll take it", "charge me", "checkout" mean: ensure the cart matches what they want (add_to_cart / get_cart), ask "anything else?" if they just added items, then collect email + shipping before prepare_commerce_checkout.
- Do **not** call prepare_commerce_checkout immediately on first buy intent if the cart may still be empty or they have not confirmed they are done adding items.
- Prefer **multi-item cart checkout**: omit quote_id so the server uses the session cart. Only use quote_id + prepare_commerce_checkout for the legacy single-quote path when you already ran get_product_quote for one line and the user is not using the cart.

## Rules
- This session is **retail checkout only**. Do NOT book appointments, run triage, or call scheduling tools.
- You are assisting with a secure transaction. If asked something you cannot resolve with the allowed commerce tools, say: "I'll need to check on that after we finish this payment," then keep the user on checkout.
- You MUST call get_product_quote before stating any price.
- NEVER invent prices or tax details from memory.
- When you have a quote result, state price using amount + currency from the tool.
- For tax status, use only the tool's price_note text verbatim.
- NEVER say "tax included" or "no tax" unless get_product_quote explicitly returns that via tax_included/price_note.
- NEVER calculate or infer tax_rate yourself.
- If quote data is unavailable, say: "I'm not able to confirm the exact price right now — please proceed to checkout for the verified total."
- Cart tools: add_to_cart / update_cart_item / remove_cart_item / get_cart / clear_cart.
- Verification tools: send_commerce_verification_code / verify_commerce_code.
- Shipping tool: save_shipping_address.
- When they are ready to pay, call prepare_commerce_checkout with customer_email and use_cart true. Shipping is already persisted by save_shipping_address.
- You may answer general questions about skincare routine or ingredients from general knowledge; for price or checkout, use tools.
- Keep replies concise and friendly.

## Directory and literature (optional)
- If the shopper asks which clinician or specialty at this clinic fits their concern, call find_clinic_specialists with a clear specialty string. Do not read phone numbers in chat unless the tool marks phone_trust as verified_directory; otherwise suggest booking or contacting the clinic through official channels.
- For general evidence or "what does research say" questions (not product price), you may call search_medical_literature; cite titles/PMIDs only, not medical advice.

## HARD RULES
- NEVER call prepare_commerce_checkout before verify_commerce_code has returned { success: true }.
- NEVER call prepare_commerce_checkout before save_shipping_address has returned { success: true }.
- NEVER tell the customer their payment is complete — only the secure payment form + settlement path can complete payment.
- If send_commerce_verification_code was already called this session, do not call it again unless customer asks to resend or verification expired.

${lang}`;
}

// ─────────────────────────────────────────────────────────────
// Tool definitions (OpenAI-compatible, Groq supports these)
// ─────────────────────────────────────────────────────────────
const KELLY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'collect_insurance',
      description: 'Verify patient insurance and return coverage quote. REQUIRES run_triage_rag first with spine codes.',
      parameters: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'Insurance member ID' },
          patient_name: { type: 'string' },
          payer_id: { type: 'string', description: 'e.g. BCBS_PILOT' },
          plan_id: { type: 'string', description: 'e.g. plan_x' },
          payer_name: { type: 'string' }
        },
        required: ['member_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compute_visit_quote',
      description: 'Compute visit copay from spine ICD/CPT and plan rules. Call after run_triage_rag.',
      parameters: {
        type: 'object',
        properties: {
          primary_icd10: { type: 'string' },
          primary_cpt: { type: 'string' },
          payer_id: { type: 'string' },
          plan_id: { type: 'string' },
          deliver_quote: { type: 'boolean', description: 'When true, mark quote as delivered to patient' }
        },
        required: ['payer_id', 'plan_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Get available appointment slots. REQUIRES run_triage_rag to have been called first. When the result includes kelly_script, say that exact script to the patient (e.g. when we could not find a native-language specialist).',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          appointment_type: { type: 'string', description: 'Specialty from triage (e.g. "Cardiology", "Psychiatry", "Primary Care")' },
          timezone: { type: 'string', description: 'Timezone, default America/New_York' },
          lane: { type: 'string', enum: ['sync', 'async'], description: 'sync = live video, async = specialist review. Severity ≥8 must use sync.' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'schedule_appointment',
      description: 'Book an appointment. REQUIRES patient_name, patient_email, patient_phone, date, time. Collect all three (name, email, phone) BEFORE calling.',
      parameters: {
        type: 'object',
        properties: {
          patient_name: { type: 'string', description: 'REQUIRED — full name' },
          patient_phone: { type: 'string', description: 'REQUIRED — phone number (e.g. +1234567890)' },
          patient_email: { type: 'string', description: 'REQUIRED — email for confirmation' },
          appointment_type: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM or "2:00 PM"' },
          timezone: { type: 'string' },
          practitioner_id: { type: 'string', description: 'From slot_bundles when available' },
          notes: { type: 'string' }
        },
        required: ['patient_name', 'patient_email', 'patient_phone', 'date', 'time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_appointments',
      description: 'Search for existing appointments by phone or email',
      parameters: {
        type: 'object',
        properties: {
          search_term: { type: 'string', description: 'Phone number or email address' }
        },
        required: ['search_term']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_checkout',
      description: 'Create payment checkout for an appointment. Sends verification code to patient email.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          customer_email: { type: 'string' },
          customer_name: { type: 'string' },
          customer_phone: { type: 'string' },
          appointment_type: { type: 'string' },
          amount: { type: 'number', description: 'Amount patient owes after insurance' }
        },
        required: ['appointment_id', 'customer_email']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_checkout_code',
      description: 'Verify the 6-digit email code and send payment link',
      parameters: {
        type: 'object',
        properties: {
          payment_token: { type: 'string' },
          verification_code: { type: 'string' }
        },
        required: ['payment_token', 'verification_code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_product_quote',
      description:
        'Retail product checkout: get a server-locked quote (amount, subtotal, tax_amount, tax_rate, tax_included, price_note, quote_id). Use before prepare_commerce_checkout. Do not state a dollar amount from user text — only values returned by this tool.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'Catalog product id' },
          provider_id: { type: 'string', description: 'Optional override; otherwise uses clinic merchant' },
          quantity: { type: 'integer' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_cart',
      description: 'Retail cart: get current in-chat cart items and subtotal for this session.',
      parameters: {
        type: 'object',
        properties: {
          provider_id: { type: 'string', description: 'Optional override; otherwise uses clinic merchant' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_to_cart',
      description: 'Retail cart: add a product to the in-chat cart. If already present, increments quantity.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'Catalog product id' },
          provider_id: { type: 'string', description: 'Optional override; otherwise uses clinic merchant' },
          quantity: { type: 'integer' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_cart_item',
      description: 'Retail cart: set quantity for one product in cart (quantity <= 0 removes item).',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'Catalog product id' },
          provider_id: { type: 'string', description: 'Optional override; otherwise uses clinic merchant' },
          quantity: { type: 'integer' }
        },
        required: ['product_id', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_cart_item',
      description: 'Retail cart: remove one product from the in-chat cart.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'Catalog product id' },
          provider_id: { type: 'string', description: 'Optional override; otherwise uses clinic merchant' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_cart',
      description: 'Retail cart: clear all items from the in-chat cart for this session.',
      parameters: {
        type: 'object',
        properties: {
          provider_id: { type: 'string', description: 'Optional override; otherwise uses clinic merchant' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_shipping_address',
      description:
        'Save the customer shipping address for commerce checkout. Must be called before prepare_commerce_checkout.',
      parameters: {
        type: 'object',
        properties: {
          line1: { type: 'string', description: 'Street address line 1' },
          line2: { type: 'string', description: 'Apartment/suite (optional)' },
          city: { type: 'string', description: 'City' },
          state: { type: 'string', description: '2-letter US state code' },
          postal_code: { type: 'string', description: '5-digit US ZIP code' },
          country: { type: 'string', description: 'Country code (default US)' },
          address_string: {
            type: 'string',
            description: 'Full address string (fallback when structured fields are unavailable)'
          },
          provider_id: { type: 'string', description: 'Optional merchant override' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_commerce_verification_code',
      description: 'Send a 6-digit verification code to the customer email. REQUIRED before prepare_commerce_checkout. Call after collecting email.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address' }
        },
        required: ['email']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_commerce_code',
      description: 'Verify the 6-digit code from email. REQUIRED after send_commerce_verification_code. Only call prepare_commerce_checkout after success.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address' },
          code: { type: 'string', description: '6-digit verification code' }
        },
        required: ['email', 'code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'prepare_commerce_checkout',
      description:
        'Start secure payment after cart is confirmed. Default: **cart checkout** — omit quote_id (or set use_cart / cart_checkout true) so the server uses the in-session cart. Only pass quote_id for legacy single-item flow after get_product_quote. Returns cart_summary, next_required_fields, and payment_action (Stripe PaymentIntent or payment link). Never set dollar amounts in args.',
      parameters: {
        type: 'object',
        properties: {
          quote_id: {
            type: 'string',
            description: 'Optional — only for single-item quote path. Omit for normal cart checkout.'
          },
          use_cart: {
            type: 'boolean',
            description: 'Optional — force cart-based checkout (default true when quote_id is omitted).'
          },
          cart_checkout: { type: 'boolean', description: 'Alias for use_cart.' },
          customer_email: { type: 'string' },
          customer_phone: { type: 'string' },
          customer_name: { type: 'string' },
          shipping_address: {
            type: 'string',
            description: 'Full shipping address for delivery (street, city, state, ZIP, country if needed)'
          }
        },
        required: ['customer_email']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_checkout_payment_status',
      description: 'Read-only: check current payment status for prepared checkout by PaymentIntent id (or session cached id).',
      parameters: {
        type: 'object',
        properties: {
          payment_intent_id: { type: 'string', description: 'Optional Stripe PaymentIntent id; uses session cached id if omitted.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_patient_claims',
      description: 'Look up recent medical claims and billing for a patient',
      parameters: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'Insurance member ID' },
          patient_name: { type: 'string' },
          payer_name: { type: 'string' }
        },
        required: ['member_id', 'patient_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_patient_payment',
      description:
        'Create a secure RCM copay/balance payment link for the patient (email/SMS). Use when patient agrees to pay copay or balance now. Never collect card numbers on the call.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in USD (e.g. copay from eligibility)' },
          journey_id: { type: 'string', description: 'RCM journey id when available' },
          patient_id: { type: 'string' },
          patient_email: { type: 'string' },
          patient_phone: { type: 'string' },
          delivery: { type: 'string', enum: ['email', 'sms', 'both'], description: 'How to send the link' }
        },
        required: ['amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_triage_session',
      description: 'Get stored OPQRST from triage_sessions. Call before run_triage_rag to merge session state.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_patient_records',
      description: "Answer patient questions about their uploaded records (labs, visit notes, imaging reports). Use when patient asks 'explain my labs', 'what did my last visit say', 'what did the doctor find', etc.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The patient question (e.g. "explain my lab results", "what did my last visit say")' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resolve_product_ingredients',
      description: 'Resolve a product name/brand to canonical product and INCI ingredient list.',
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: 'Product name to match (e.g. "CeraVe Hydrating Cleanser")' },
          brand: { type: 'string', description: 'Optional brand name filter' }
        },
        required: ['product_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'lookup_ingredient_functions',
      description: 'Lookup ingredient (INCI) functions and regulatory restrictions for cosmetic guidance.',
      parameters: {
        type: 'object',
        properties: {
          inci_list: {
            oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
            description: 'INCI ingredient list (array or comma-separated string)'
          }
        },
        required: ['inci_list']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_skincare_routine',
      description:
        'Deterministic skincare conflict check on resolved canonical ingredient IDs (e.g. cosing:retinol). Returns RoutineVerdict JSON: overall safe|caution|avoid, conflicts[], reason_codes for RAG, suggested_split, and **evidence_bundle** `{ schema_version, chunks, chunk_ids, coverage }` (single canonical RAG surface). You must not soften an avoid verdict. Call when the user lists products/actives for the same day or asks if combinations are safe.',
      parameters: {
        type: 'object',
        properties: {
          slots: {
            type: 'array',
            description: 'Routine slots with AM/PM ingredient id lists',
            items: {
              type: 'object',
              properties: {
                time: { type: 'string', enum: ['am', 'pm'] },
                ingredient_ids: {
                  type: 'array',
                  items: { type: 'string', description: 'Canonical id e.g. cosing:retinol or bare inci key' }
                }
              },
              required: ['time', 'ingredient_ids']
            }
          }
        },
        required: ['slots']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'retrieve_ingredient_monographs',
      description:
        'Fetch short curated monograph chunks for education (ingredient ids and/or graph reason_codes like class:retinoid). Use after evaluate_skincare_routine or for ingredient deep-dives.',
      parameters: {
        type: 'object',
        properties: {
          ingredient_ids: { type: 'array', items: { type: 'string' } },
          reason_codes: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_ingredient_resolution_metrics',
      description:
        'Internal/catalog metric: % of product ingredient rows resolved to COSING and top unresolved INCI tokens. Use for gap analysis, not patient-facing.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_catalog_coverage_metrics',
      description:
        'Internal X2 metric: product/SKU catalog rows, knowledge_chunks and ingredient_rag counts, and conflict-pair coverage in knowledge_chunks (pair_key). For ops/gap analysis, not patient-facing.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'store_triage_opqrst',
      description: 'Store OPQRST (symptom HPI). Call after EACH material OPQRST answer — do not wait until the end. Use `store_triage_rich_intake` for meds/allergies/PMH/FHx/social context.',
      parameters: {
        type: 'object',
        properties: {
          onset: { type: 'string', description: 'When did symptoms start?' },
          provocation: { type: 'string' },
          quality: { type: 'string' },
          radiation: { type: 'string' },
          severity: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '1-10 or "unknown" if not yet specified' },
          timing: { type: 'string' },
          associated_sx: { type: 'string' },
          family_history: { type: 'string', description: 'Family medical history (e.g. heart disease, cancer)' },
          medications: { type: 'string', description: 'Current medications (including OTC/supplements)' },
          prior_diagnoses: { type: 'string', description: 'Known conditions' },
          prior_workups: { type: 'string', description: 'Prior ECG, labs, imaging' },
          allergies: { type: 'string', description: 'Drug or food allergies' },
          alcohol_use: { type: 'string', description: 'Alcohol use description' },
          alcohol_cage_score: {
            oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }],
            description: 'CAGE-4 score 0-4 (2+ = positive) or null if unknown'
          },
          smoking_status: { type: 'string' },
          phq2_q1: { type: 'string', description: 'PHQ-2 Q1 answer (little interest/pleasure)' },
          phq2_q2: { type: 'string', description: 'PHQ-2 Q2 answer (down/depressed/hopeless)' },
          gad2_q1: { type: 'string', description: 'GAD-2 Q1 answer (nervous/anxious)' },
          gad2_q2: { type: 'string', description: 'GAD-2 Q2 answer (unable to stop worrying)' },
          safety_screen_q1: { type: 'string', description: 'Columbia: wished you were dead?' },
          safety_screen_q2: { type: 'string', description: 'Columbia: thoughts of killing yourself?' },
          substance_use: { type: 'string' },
          skin_type: { type: 'string', description: 'Skin type (oily/dry/combination/normal/unsure/etc. per clinic spec).' },
          skin_concerns_json: {
            oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
            description: 'Skin concerns as string array or JSON array string.'
          },
          pregnancy_status: {
            type: 'string',
            description: 'Safety: not_pregnant_not_bf / pregnant / breastfeeding / trying / prefer_not_say / unknown.'
          },
          prior_dermatologist_json: {
            type: 'object',
            description: 'Whether they saw a dermatologist for this issue.',
            properties: {
              seen: { type: 'boolean', description: 'true/false once answered' },
              note: { type: 'string', description: 'Optional short detail' }
            }
          },
          functional_impact: {
            type: 'integer',
            description: '1-5: how much the concern affects daily life (5 = severe impact).'
          },
          ingredient_reactions: { type: 'string', description: 'Ingredients or products that caused reactions.' },
          what_has_worked: { type: 'string', description: 'What has helped before.' },
          hormonal_context: { type: 'string', description: 'Life-stage hormonal context (no LMP).' },
          lifestyle_notes: { type: 'string', description: 'Sleep, stress, diet, exercise, hydration notes.' },
          environment_notes: { type: 'string', description: 'Climate, sun, water, pollution, etc.' },
          triggers_json: {
            oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
            description: 'Flare triggers as string array or JSON array string.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'store_triage_rich_intake',
      description: 'Store non-OPQRST rich intake (meds, allergies, PMH, FHx/SHx). Merge into triage_sessions for the current session.',
      parameters: {
        type: 'object',
        properties: {
          // IMPORTANT: the model sometimes emits `null` or a plain string instead of an array.
          // KellyToolExecutor can normalize either, so the schema must accept both.
          session_id: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Current session_id (optional; use context if omitted)'
          },
          medications: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' }
            ],
            description: 'Medications list (array or comma-separated string)'
          },
          allergies: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' }
            ],
            description: 'Allergies list (array or comma-separated string)'
          },
          prior_diagnoses: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' }
            ],
            description: 'Known conditions list (array or comma-separated string)'
          },
          prior_workups: { type: 'string', description: 'Prior tests (ECG, labs, imaging)' },
          family_history: { type: 'string', description: 'Family medical history' },
          alcohol_use: { type: 'string', description: 'Alcohol use description' },
          smoking_status: { type: 'string', description: 'Smoking status' },
          substance_use: { type: 'string', description: 'Other substance use' },
          occupation: { type: 'string', description: 'Occupation (incl. exposures if relevant)' },
          critical_unknowns: { type: 'array', items: { type: 'string' }, description: 'Missing critical history items from triage' },
          skin_type: { type: 'string' },
          skin_concerns_json: {
            oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }]
          },
          pregnancy_status: { type: 'string' },
          prior_dermatologist_json: {
            type: 'object',
            properties: {
              seen: { type: 'boolean' },
              note: { type: 'string' }
            }
          },
          functional_impact: { type: 'integer' },
          ingredient_reactions: { type: 'string' },
          what_has_worked: { type: 'string' },
          hormonal_context: { type: 'string' },
          lifestyle_notes: { type: 'string' },
          environment_notes: { type: 'string' },
          triggers_json: {
            oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }]
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_medical_literature',
      description:
        'Search PubMed for evidence summaries (titles + links). Use for guideline-style questions; cite PMIDs/URLs. Do not use this for finding doctor phone numbers.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Clinical question or keywords for PubMed' },
          max_results: { type: 'integer', description: '1–10, default 5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_clinic_specialists',
      description:
        'List in-network specialists for this clinic from the verified directory (not web search). Returns provider_cards with phone_trust; only show phone numbers when phone_trust is verified_directory — otherwise offer booking / contact clinic.',
      parameters: {
        type: 'object',
        properties: {
          specialty: { type: 'string', description: 'e.g. Cardiology, Dermatology, Primary Care' },
          language: { type: 'string', description: 'ISO code, default en' },
          state: { type: 'string', description: 'US state code for license filter, optional' },
          lane: { type: 'string', enum: ['sync', 'async'], description: 'sync = live, async = review' },
          urgency: { type: 'string', enum: ['routine', 'urgent', 'emergent'] },
          patient_tier: { type: 'integer', description: '1–4, default 2' },
          date: { type: 'string', description: 'YYYY-MM-DD for async quota' },
          limit: { type: 'integer', description: 'Max cards 1–10, default 3' }
        },
        required: ['specialty']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_triage_rag',
      description: 'Analyze symptoms to determine specialty, urgency, safety. Call after collecting OPQRST and (when relevant) rich intake. Merge get_triage_session + current turn. When result includes low_confidence or suggested_next_step, ask one more clarifying question then call again — do NOT proceed to get_available_slots. After specialty deep-dive, call again with full history.',
      parameters: {
        type: 'object',
        properties: {
          symptom_text: { type: 'string', description: 'Full symptom description' },
          onset: { type: 'string' },
          quality: { type: 'string' },
          severity: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '1-10 or "unknown"' },
          radiation: { type: 'string' },
          timing: { type: 'string' },
          associated_sx: { type: 'string' },
          family_history: { type: 'string' },
          medications: { type: 'string' },
          prior_diagnoses: { type: 'string' },
          prior_workups: { type: 'string' },
          allergies: { type: 'string' },
          alcohol_use: { type: 'string' },
          // The model sometimes emits `null` here when alcohol history is missing.
          // Allow null so Groq doesn't reject the tool call before our executor runs.
          alcohol_cage_score: {
            oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }],
            description: 'CAGE-4 score 0-4 (or null if unknown)'
          },
          safety_screen: { type: 'string', description: 'positive if safety screen yes; negative otherwise' },
          // The model sometimes emits these question-level answers. Accept them so
          // Groq doesn't reject the tool call before our executor can coerce them.
          phq2_q1: { type: 'string', description: 'PHQ-2 question 1 answer (yes/no)' },
          phq2_q2: { type: 'string', description: 'PHQ-2 question 2 answer (yes/no)' },
          gad2_q1: { type: 'string', description: 'GAD-2 question 1 answer (yes/no)' },
          gad2_q2: { type: 'string', description: 'GAD-2 question 2 answer (yes/no)' },
          safety_screen_q1: { type: 'string', description: 'Columbia protocol question 1 answer (yes/no)' },
          safety_screen_q2: { type: 'string', description: 'Columbia protocol question 2 answer (yes/no)' }
        },
        required: ['symptom_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_document_upload',
      description: 'Ask patient to upload a photo or document (rash, ECG, lab results, etc.)',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the upload is needed (e.g. "skin rash photo", "ECG report")' },
          patient_email: { type: 'string' },
          patient_phone: { type: 'string' }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the call or conversation when the patient is done',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the call is ending' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'return_to_triage',
      description:
        'Call when the patient reports NEW or changed symptoms during booking/checkout or when the conversation must return to clinical triage before scheduling. Re-opens triage tools; do not call scheduling slots until run_triage_rag completes again.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason (e.g. "new chest pain during slot selection")' }
        }
      }
    }
  },
  ...(DERM_EDUCATION_PIPELINE_ENABLED
    ? [
        {
          type: 'function',
          function: {
            name: 'run_derm_patient_qa',
            description:
              'Dermatology/skin education Q&A (information only, not a diagnosis). Use for general skin questions, routine product questions, or benign skin topics when the patient is not describing a new acute emergency. Do NOT use for chest pain, stroke symptoms, or other systemic emergencies — use OPQRST + run_triage_rag for new concerning symptoms. Returns answer_text and citation metadata.',
            parameters: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Patient question in their words' },
                image_caption: { type: 'string', description: 'Optional short description if they shared a skin photo' },
                image_present: { type: 'boolean', description: 'True if a photo was provided' }
              },
              required: ['message']
            }
          }
        }
      ]
    : [])
];

const COMMERCE_CHECKOUT_TOOLS = KELLY_TOOLS.filter(
  (t) => [
    'get_product_quote',
    'get_cart',
    'add_to_cart',
    'update_cart_item',
    'remove_cart_item',
    'clear_cart',
    'save_shipping_address',
    'send_commerce_verification_code',
    'verify_commerce_code',
    'prepare_commerce_checkout',
    'get_checkout_payment_status',
    'find_clinic_specialists',
    'search_medical_literature'
  ].includes(t?.function?.name)
);

function _mergeUiSnapIntoReturn(uiSnap, obj) {
  const o = { ...obj };
  if (uiSnap?.provider_cards?.length) o.provider_cards = uiSnap.provider_cards;
  if (uiSnap?.literature_snippets?.length) o.literature_snippets = uiSnap.literature_snippets;
  return o;
}

function _sessionMetaBool(sessionId, key) {
  try {
    const v = String(KellyToolExecutor._getSessionMeta(sessionId, key) || '').toLowerCase();
    return v === '1' || v === 'true';
  } catch (_) {
    return false;
  }
}

/**
 * Phase 4b: structured fields for landing/UI when Skin & Care assessment is active or complete.
 * @param {string} sessionId
 * @param {{ phase?: string }|null} orchestration
 */
function _skincareAssessmentClientPayload(sessionId, orchestration) {
  const routine = _sessionMetaBool(sessionId, 'routine_intake_active');
  const intakeDone = _sessionMetaBool(sessionId, 'intake_complete');
  const skinPost = _sessionMetaBool(sessionId, 'skincare_post_intake');
  if (!routine && !intakeDone) return null;
  let gaps = [];
  let hardMissing = [];
  try {
    gaps = JSON.parse(KellyToolExecutor._getSessionMeta(sessionId, 'skincare_intake_gaps_json') || '[]');
  } catch (_) {}
  try {
    hardMissing = JSON.parse(
      KellyToolExecutor._getSessionMeta(sessionId, 'skincare_intake_hard_missing_json') || '[]'
    );
  } catch (_) {}
  const complete = !!(intakeDone && skinPost);
  return {
    intake_complete: intakeDone,
    skincare_assessment_complete: complete,
    report_ready: complete,
    next_ui_step: complete ? 'skincare_report' : 'skincare_intake',
    orchestrator_phase: orchestration?.phase ?? null,
    skincare_intake_gaps: Array.isArray(gaps) ? gaps : [],
    skincare_intake_hard_missing: Array.isArray(hardMissing) ? hardMissing : []
  };
}

function _appendSkincareAssessmentToReturn(sessionId, orchestration, obj) {
  const p = _skincareAssessmentClientPayload(sessionId, orchestration);
  if (p) Object.assign(obj, p);
  return obj;
}

function _checkoutReply(
  reply,
  toolsUsed,
  language,
  checkout_stage,
  policy_flags,
  allowed_next_actions,
  commerce_checkout,
  quote_id,
  redirect_to,
  next_chips,
  chips_display,
  llm_usage,
  ui = {}
) {
  const base = {
    reply,
    endCall: false,
    toolsUsed: toolsUsed || [],
    language,
    checkout_stage: checkout_stage || null,
    policy_flags: policy_flags || {},
    allowed_next_actions: allowed_next_actions || [],
    commerce_checkout: commerce_checkout || null,
    quote_id: quote_id || null,
    redirect_to: redirect_to || null,
    next_chips: next_chips || [],
    chips_display: chips_display || null,
    llm_usage: llm_usage || null
  };
  if (ui?.provider_cards?.length) base.provider_cards = ui.provider_cards;
  if (ui?.literature_snippets?.length) base.literature_snippets = ui.literature_snippets;
  return base;
}

function _stageToPolicyFlags(stage) {
  return {
    collecting_details: {},
    code_sent: {},
    code_verified: {},
    checkout_prepared: { can_show_payment_form: true },
    payment_confirmed: { payment_confirmed: true, can_show_payment_form: false },
    failed: { payment_failed: true }
  }[stage] || {};
}

function _stageToActions(stage) {
  return {
    collecting_details: ['collect_email'],
    code_sent: ['enter_code'],
    code_verified: ['continue_secure_checkout'],
    checkout_prepared: ['complete_payment_form'],
    payment_confirmed: ['view_receipt', 'track_delivery'],
    failed: ['retry_checkout']
  }[stage] || [];
}

// ─────────────────────────────────────────────────────────────
// Main entry point

module.exports = {
  getGroq,
  GROQ_MODEL,
  GROQ_FALLBACK_MODEL,
  MAX_HISTORY_TURNS,
  MAX_HISTORY_CONTENT_CHARS_VOICE,
  MAX_HISTORY_CONTENT_CHARS_CHAT,
  DERM_EDUCATION_PIPELINE_ENABLED,
  SKIN_TAXONOMY_SHADOW_MODE,
  SKIN_CONFLICT_HARD_GUARD,
  GRAPH_GATE_ENFORCE,
  KELLY_PRODUCT_TAXONOMY_CAPTURE,
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
};
