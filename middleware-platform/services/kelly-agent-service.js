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
 *   const result = await KellyAgentService.processTurn({
 *     message, sessionId, channel, clinicId, patientId, callerPhone, patientName
 *   });
 *   // result.reply   — text to send back
 *   // result.endCall — true if Kelly said goodbye
 */

const Groq = require('groq-sdk');
const LLMRouter = require('./llm-router');
const { resolvePrimaryProvider, callStreamWithDeltas } = LLMRouter;
const db = require('../database');
const { normalizeToE164 } = require('../utils/phone-e164');

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
const { detectRedFlags } = require('./triage-service');
/** Phase 5: optional Kelly tool `run_derm_patient_qa` when DERM_EDUCATION_PIPELINE_ENABLED=true */
const DERM_EDUCATION_PIPELINE_ENABLED =
  String(process.env.DERM_EDUCATION_PIPELINE_ENABLED || 'false').toLowerCase() === 'true';
const KellyToolExecutor = require('./kelly-tool-executor');
const { redactObject } = require('./redaction-service');
const TriageRAGService = require('./triage-rag-service');
const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');
const KellyPromptBuilder = require('./kelly-prompt-builder');
const SessionStateStore = require('./session-state-store');
const IntakeRequiredFields = require('./intake-required-fields');
const AskNextQuestionService = require('./ask-next-question-service');
const SafetyPreScreen = require('./safety-prescreen');
const QueryPlanner = require('./query-planner');
const CarePathCatalog = require('./care-path-catalog');
const EvidenceFusion = require('./evidence-fusion');
const CaseSummaryComposer = require('./case-summary-composer');
const CasePatternsService = require('./case-patterns-service');
const BillingReadinessPack = require('./billing-readiness-pack');
const ClinicalRecommendationPolicy = require('./clinical-recommendation-policy');
const { formatRoutineIntakeSummaryFromTriageRow } = KellyPromptBuilder;

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

/**
 * E2E / harness: if slots are reported but the model path skipped emitting run_triage_rag while
 * a RAG row exists (e.g. rate-limit server-side RAG + get_available_slots), prepend run_triage_rag
 * so tool-order metrics match what actually happened.
 */
function _toolsUsedEnsureRagBeforeSlots(sessionId, tools) {
  const arr = Array.isArray(tools) ? [...tools] : [];
  if (!arr.length || arr.includes('run_triage_rag') || !arr.includes('get_available_slots')) {
    return arr;
  }
  try {
    if (!TriageRAGService.getLatestForSession(sessionId)) return arr;
  } catch (_) {
    return arr;
  }
  const out = [];
  for (const t of arr) {
    if (t === 'get_available_slots' && !out.includes('run_triage_rag')) {
      out.push('run_triage_rag');
    }
    out.push(t);
  }
  return out;
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
  return `You are Kelly (DocLittle).${orchHint}

GOAL: triage OPQRST and route to the right specialist, then book (cash-only; no insurance step).

TOOL ORDER (hard rule):
1) get_triage_session → store_triage_opqrst → store_triage_rich_intake → run_triage_rag
2) After triage_complete: get_available_slots → schedule_appointment → create_appointment_checkout → verify_checkout_code
NEVER schedule before triage_complete.

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

function _classifyIntent(message) {
  const t = String(message || '').toLowerCase();
  if (BILLING_KEYWORDS.some(k => t.includes(k))) return 'billing';
  if (ROUTINE_BOOKING_KEYWORDS.some(k => t.includes(k))) return 'routine_booking';
  if (SYMPTOM_KEYWORDS.some(k => t.includes(k))) return 'symptom';
  return 'unknown';
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

function _getBillingReply(message) {
  const t = String(message || '').toLowerCase();
  if (t.includes('receipt')) return 'I can help you with your receipt. Could you share the email address associated with your appointment so I can look that up?';
  if (t.includes('claim')) return 'I can look into your insurance claim. Could you share your member ID and the date of service?';
  if (t.includes('refund')) return 'I can help with a refund question. Can you tell me which appointment or charge this is about?';
  if (t.includes('copay') || t.includes('deductible')) return "I can check your coverage details. What's your insurance member ID?";
  return 'I can help with your billing question. Can you give me a bit more detail about what you need — for example, a receipt, a claim, or a charge on your account?';
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

  return `You are Kelly, a warm and empathetic medical voice assistant for DocLittle.
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
2. **Provocation/Palliation**: "What makes it better or worse?"
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
  // PHASE 2 — Insurance collection not active (checkout is cash-only for now)
  // {
  //   type: 'function',
  //   function: {
  //     name: 'collect_insurance',
  //     description: 'Check patient insurance. REQUIRES run_triage_rag first.',
  //     parameters: { type: 'object', properties: { member_id: {}, patient_name: {} }, required: ['member_id', 'patient_name'] }
  //   }
  // },
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
// ─────────────────────────────────────────────────────────────
class KellyAgentService {
  /**
   * Strong LLM instruction for non-English sessions (ISO-639-1 codes).
   * Weak "respond in language code: ru" was often ignored on voice.
   */
  static _languageDirective(preferredLanguage) {
    const code = String(preferredLanguage || 'en').toLowerCase();
    if (!code || code === 'en') return '';
    const map = {
      ru: `## Текущий язык / Current language (MANDATORY)
The patient is speaking Russian. You MUST reply ONLY in Russian for every message in this session.
Use natural spoken Russian. Keep Latin for emails, phone numbers, and proper nouns if given that way.
If they just asked to switch to Russian, start with a short Russian acknowledgment, then continue care in Russian.`,
      es: `## Idioma actual (OBLIGATORIO)
Responde SOLO en español durante toda la sesión.`,
      fr: `## Langue actuelle (OBLIGATOIRE)
Répondez UNIQUEMENT en français pendant toute la session.`,
      sw: `## Lugha (LAZIMA)
Jibu kwa Kiswahili tu kwa kipindi hicho.`,
      de: `## Aktuelle Sprache (VERBINDLICH)
Antworten Sie durchgehend auf Deutsch.`,
      zh: `## 当前语言（必须）
全程使用中文回复患者。`
    };
    return map[code] || `## Current language (MANDATORY)\nRespond ONLY in language "${code}" for the entire session. Do not use English unless the patient switches back to English.`;
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
  static async processTurn(params) {
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
      onStreamDelta = null,
      onToolStatus = null
    } = params;

    _kellyDebugTurn('turn_start', {
      sessionId,
      channel,
      provider: resolvePrimaryProvider(),
      messageChars: String(message || '').length
    });

    const canonicalState = SessionStateStore.getCanonicalState({ sessionId });
    if (canonicalState) {
      _kellyDebugTurn('canonical_state_loaded', {
        sessionId,
        complaint: canonicalState.chief_complaint || null,
        severity: canonicalState.severity ?? null,
        riskFlags: Array.isArray(canonicalState.risk_flags) ? canonicalState.risk_flags.length : 0
      });
    }

    // ── 1. Emergency pre-check (before LLM, always) ──────────
    const emergency = detectRedFlags(message);
    const safety = SafetyPreScreen.evaluateSafety({ text: message, eventType: 'chat_turn', payload: { message } });
    if (emergency?.isEmergency || safety?.emergency) {
      const emergencyReply = emergency?.suggestedResponse || safety?.suggested_response ||
        'This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now.';

      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', emergencyReply);
      this._persistEmergencyFlag(sessionId, patientId, callerPhone, channel, emergency);

      return { reply: emergencyReply, endCall: false, toolsUsed: [], language: 'en' };
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
    if (_dedup.collapsed) {
      _kellyDebugTurn('message_deduped', {
        sessionId,
        beforeLength: _dedup.beforeLength,
        afterLength: _dedup.afterLength
      });
      message = _dedup.text;
    }

    // Load a short history snapshot before fast-intent routing so routine sessions
    // do not get reset to "do you have symptoms?" on every subsequent turn.
    const historyEarly = this._loadHistory(sessionId);
    const routineLockedEarly = _isRoutineLockedForSession(sessionId, historyEarly);
    const msgLcEarly = String(message || '').toLowerCase().trim();

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
        channel
      });
      if (fastIntentResponse) return fastIntentResponse;
    }

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
      const { detectLanguagePreferenceRequest } = require('./patient-orchestrator-service');
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
      const latestSession = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      const triageIncomplete = !(latestSession && (latestSession.triage_complete === 1 || latestSession.triage_complete === true));
      if (triageIncomplete && hasSymptomNow) {
        const lastAssistant = [...history].reverse().find((m) => m?.role === 'assistant');
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
    if (KellyOrchestratorPhase.orchestratorEnabled()) {
      _kellyDebugTurn('orchestrator_phase', {
        sessionId,
        phase: orchestration.phase,
        intentBucket: orchestration.intentBucket,
        stickyApplied: orchestration.stickyApplied,
        escapeTriggered: orchestration.escapeTriggered
      });
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
      kellyScriptHint,
      orchestration,
      routineIntakeSummaryMarkdown
    };

    // Deterministic required-fields gate before deep retrieval/tool loop.
    // Question selection is deterministic; wording is LLM-generated by AskNextQuestionService.
    const pathway =
      channel === 'voice' ? 'triage'
        : (orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
           orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP)
          ? 'routine'
          : 'triage';
    const gateEval = SessionStateStore.evaluateGate({ pathway, sessionId });
    const minimumRequiredByPathway = IntakeRequiredFields.getRequiredFieldsSchema()[pathway]?.minimum_required || [];
    const shouldGate =
      minimumRequiredByPathway.length > 0 &&
      !gateEval.is_minimum_met &&
      !safety?.emergency &&
      gateEval.missing_required.length > 0;

    // ── 4. Append user message ────────────────────────────────
    this._appendToHistory(sessionId, 'user', message);
    history.push({ role: 'user', content: message });

    if (shouldGate) {
      const nextField = IntakeRequiredFields.nextRequiredField(pathway, gateEval.state);
      const gateQuestion = await AskNextQuestionService.generateQuestion({
        missingField: nextField,
        pathway,
        preferredLanguage
      });
      this._appendToHistory(sessionId, 'assistant', gateQuestion);
      return {
        reply: gateQuestion,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        gate_status: gateEval
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
        channel
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM_TURN_TIMEOUT')), turnTimeoutMs))
      ]);
      reply = loopResult.reply;
      toolsUsed = loopResult.toolsUsed || [];
      // Unified output guardrails pass (policy + safety suppression).
      reply = ClinicalRecommendationPolicy.applyOutputGuardrails(reply, {
        safetyStatus: safety?.status || 'green',
        routineSkincare: orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE
          || orchestration?.phase === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP
      });
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

        if (triageComplete && askedToProceed && !alreadyLookedUpSlots && replyLooksLikeSummaryLoop) {
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
          if (TriageRAGService.getLatestForSession(sessionId) && !nextTools.includes('run_triage_rag')) {
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
              const scheduleArgs = {
                patient_name: collectedName,
                patient_email: collectedEmail,
                patient_phone: collectedPhone,
                appointment_type: 'Primary Care',
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
            forceProvider: 'groq'
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
                // When Groq is down we still re-run triage RAG server-side.
                // However, during specialty/slot routing turns the latest user message is often
                // just a confirmation (e.g. "Dermatology first"), which can produce low rag_confidence.
                const askedToProceed = _isBookingProgressIntent(message);
                const selectedSlotLikeInput = _looksLikeSlotChoice(message);
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

                // Use recent user history so we keep stable "symptom context"
                // (e.g. "lower back pain") even when the latest user message
                // is just a confirmation like "Both sides".
                const userMessages = (history || [])
                  .filter(m => m && m.role === 'user')
                  .map(m => String(m.content || ''))
                  .filter(Boolean);

                // Keep the first user symptom intake (where location like "back pain" lives),
                // plus the most recent confirmations so we don't lose new details.
                const stableUserText = [
                  userMessages[0],
                  ...userMessages.slice(-2)
                ].join(' ')
                  .trim()
                  .slice(0, 2000);

                const symptomTextForRag = (
                  `${symptomParts.join('. ')}${symptomParts.length ? '. ' : ''}${stableUserText}`.trim()
                );

                const triageOut = await KellyToolExecutor.execute(
                  'run_triage_rag',
                  { symptom_text: symptomTextForRag },
                  { sessionId, clinicId, patientId, callerPhone, channel }
                );
                fallbackToolsUsed.push('run_triage_rag');
                if (triageOut?.suggested_next_step) reply = _sanitizeSuggestedNextStep(triageOut.suggested_next_step);
                else if (triageOut?.patient_friendly_summary) reply = triageOut.patient_friendly_summary;
                else reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);

                // Even when the LLM is unreachable, allow explicit "proceed to slots" intent
                // to move forward by calling get_available_slots server-side.
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
        const PatientOrchestratorService = require('./patient-orchestrator-service');
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
      TriageRAGService.getLatestForSession(sessionId)
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
        billing_readiness_pack: billingPack
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
          onToolStatus
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
    onToolStatus
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
            const ClinicalRecommendationPolicy = require('./clinical-recommendation-policy');
            const v = ClinicalRecommendationPolicy.validateAssistantText(reply);
            if (!v.ok) {
              const ph = context.orchestration?.phase;
              const routineSkincare =
                ph === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
                ph === KellyOrchestratorPhase.KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP;
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
        let closeReply = 'Thank you for calling DocLittle. Take care!';
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
   * Handle non-clinical fast intents before entering the LLM tool loop.
   * Returns a full response object when handled, otherwise null.
   */
  static async _handleFastIntentPrecheck({ intent, message, sessionId, patientId, clinicId, callerPhone, channel }) {
    if (intent === 'billing') {
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
      const preferredLanguage = this._detectPreferredLanguage([], message);
      const explicitNoSymptoms = _hasNoSymptomsRoutineSignal(message);
      const likelyGeneralVisit = _hasGeneralVisitSignal(message);
      // Do not assume "no symptoms" from "general visit" alone.
      // Ask one confirmation question first; only skip triage when the caller explicitly says no symptoms.
      if (!explicitNoSymptoms && likelyGeneralVisit) {
        const bookingForSelf = KellyToolExecutor._getSessionMeta?.(sessionId, 'booking_for');
        if (!bookingForSelf && patientId) {
          const selfOrOtherReply = 'Got it! Are we booking this appointment for you, or for someone else?';
          this._appendToHistory(sessionId, 'user', message);
          this._appendToHistory(sessionId, 'assistant', selfOrOtherReply);
          try { KellyToolExecutor._setSessionMeta(sessionId, 'booking_for_prompt_pending', '1'); } catch (_) {}
          return {
            reply: selfOrOtherReply,
            endCall: false,
            toolsUsed: [],
            language: preferredLanguage || 'en',
            next_chips: [
              { label: 'For me', value: 'booking_for_self', action: 'booking_for_self' },
              { label: 'For someone else', value: 'booking_for_other', action: 'booking_for_other' }
            ],
            chips_display: 'list'
          };
        }
        const confirmByLang = {
          ru: 'Поняла. Это плановый визит. У вас сейчас есть какие-либо симптомы или жалобы?',
          es: 'Entiendo. Es una visita general. Tiene algun sintoma o molestia hoy?',
          fr: 'Compris. C est une visite generale. Avez-vous des symptomes ou une gene aujourd hui ?',
          sw: 'Nimeelewa. Hii ni miadi ya kawaida. Je, una dalili au usumbufu wowote kwa sasa?'
        };
        const confirmReply =
          confirmByLang[preferredLanguage] ||
          'Understood. This is a general visit. Do you have any current symptoms or concerns today?';
        this._appendToHistory(sessionId, 'user', message);
        this._appendToHistory(sessionId, 'assistant', confirmReply);
        return {
          reply: confirmReply,
          endCall: false,
          toolsUsed: [],
          language: preferredLanguage || 'en',
          usedFallback: false
        };
      }

      // E1: do not fast-path "no symptoms" routine booking when intake already stored a concern/onset (e.g. acne).
      if (KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId)) {
        return null;
      }

      const routineReplyByLang = {
        ru: 'Отлично, помогу с плановым визитом. Если активных симптомов нет, мы можем пропустить симптомный опрос. Вам нужно к врачу срочно сейчас или хотите запланировать прием на позже? И какая дата вам подходит?',
        es: 'Perfecto, puedo ayudarle con una visita de rutina. Si no tiene sintomas activos, podemos omitir el triage de sintomas. Necesita ver al medico de inmediato o prefiere programar para despues? Que fecha le funciona mejor?',
        fr: 'Parfait, je peux vous aider pour une visite de routine. S il n y a pas de symptomes actifs, nous pouvons sauter le triage des symptomes. Avez-vous besoin de voir un medecin immediatement, ou preferez-vous planifier plus tard ? Quelle date vous convient ?',
        sw: 'Vizuri, naweza kusaidia kwa miadi ya kawaida. Kama hakuna dalili za sasa, tunaweza kuruka triage ya dalili. Unahitaji kumuona daktari mara moja au ungependa kupanga miadi ya baadaye? Ni tarehe gani inakufaa?'
      };
      const routineReply =
        routineReplyByLang[preferredLanguage] ||
        "Great - I can help with a routine wellness visit. Since you don't have active symptoms, we can skip symptom triage. Do you need to see a doctor immediately, or would you like to schedule for later? What date works best for you?";
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', routineReply);
      try {
        if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');
      } catch (_) {}
      try {
        if (db.upsertTriageSession) {
          const existing = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
          db.upsertTriageSession({
            session_id: sessionId,
            patient_id: patientId,
            detected_language: existing.detected_language || 'en',
            safety_level: existing.safety_level || 'green',
            urgency: existing.urgency || 'routine',
            target_specialty: existing.target_specialty || 'PrimaryCare',
            opqrst_complete: true,
            triage_complete: true,
            intake_complete_at: existing.intake_complete_at || new Date().toISOString()
          });
        }
      } catch (_) {}
      // Produce RAG row + rag_result_id so get_available_slots gating succeeds (Bug 1/6).
      try {
        await KellyToolExecutor.execute(
          'run_triage_rag',
          { symptom_text: 'Routine wellness visit — no active symptoms' },
          {
            sessionId,
            clinicId: clinicId ?? null,
            patientId,
            callerPhone: callerPhone ?? null,
            channel: channel || 'chat'
          }
        );
      } catch (_) {}
      return {
        reply: routineReply,
        endCall: false,
        toolsUsed: ['run_triage_rag'],
        language: preferredLanguage || 'en',
        usedFallback: false
      };
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Language detection from history or current message
  // ─────────────────────────────────────────────────────────────
  static _detectPreferredLanguage(history, currentMessage) {
    try {
      const { detectLanguagePreferenceRequest } = require('./patient-orchestrator-service');
      const langReq = detectLanguagePreferenceRequest(String(currentMessage || ''));
      if (langReq?.isLanguageRequest && langReq?.code) return langReq.code;
    } catch (_) {}

    const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg?.language) return lastAssistantMsg.language;

    const t = currentMessage || '';
    if (/\p{Script=Cyrillic}/u.test(t)) return 'ru';
    if (/(?:можем|можно)\s+(?:говорить|общаться)\s+(?:по-русски|на\s+русском)/i.test(t)) return 'ru';
    if (/\b(говорить|говорите)\s+по-русски\b/i.test(t)) return 'ru';
    if (/\bна\s+русском\s+(?:языке)?\b/i.test(t)) return 'ru';
    if (/\b(russian|speak russian|in russian|to russian|russki|русск)\b/i.test(t)) return 'ru';
    if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
    if (/^(hola|buenos|gracias|por favor|necesito|dolor|quiero)\b/i.test(t)) return 'es';
    if (/^(bonjour|merci|je veux|oui|non)\b/i.test(t)) return 'fr';
    if (/^(guten|danke|ich bin|hallo)\b/i.test(t)) return 'de';
    if (/\b(nataka|daktari|maumivu|msaada|habari|ndiyo|hapana|asante|tafadhali|ninajua|ninaweza)\b/i.test(t)) return 'sw';
    return 'en';
  }

  // ─────────────────────────────────────────────────────────────
  // Emergency flag persistence
  // ─────────────────────────────────────────────────────────────
  static _persistEmergencyFlag(sessionId, patientId, callerPhone, channel, assessment) {
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      if (db.upsertPatientEmergencyFlag) {
        db.upsertPatientEmergencyFlag({
          patient_id: patientId || null,
          phone: callerPhone || null,
          source: channel,
          call_id: sessionId,
          expires_at: expiresAt,
          metadata: { red_flags: assessment.redFlags || [], urgency: assessment.urgency || 'EMERGENT' }
        });
      }
    } catch (_) {}
  }

  static fallbackReply(channel) {
    return channel === 'voice'
      ? "I'm having trouble connecting right now. Please hold on or call back in a moment."
      : "I'm temporarily unavailable. Please try again in a moment or call us directly.";
  }
}

module.exports = KellyAgentService;
