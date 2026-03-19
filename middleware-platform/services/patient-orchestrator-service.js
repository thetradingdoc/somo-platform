/**
 * PatientOrchestratorService — Step 1: Multi-Modal Front Door
 *
 * DEPRECATED (K-8): Primary flow now uses KellyAgentService (LLM). This service
 * remains as fallback when KELLY_LLM_ENABLED=0 or LLM errors, and for emergency
 * (detectRedFlags) handling. Prefer KellyAgentService for new features.
 *
 * Unified backend for Voice (Retell) and Chat (Web). Stateful sessions;
 * language detection in first 1–2 turns; store original + English translation.
 * Session handover (Voice → Chat via patient_id) and resume on callback.
 */

const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const { detectRedFlags } = require('./triage-service');
const knowledgeService = require('./knowledge-service');
let piiRedactor;
try {
  piiRedactor = require('../utils/pii-redactor');
} catch (_) {
  piiRedactor = null;
}

const LANGUAGE_DETECTION_TURNS = 2;

/** u-5: Channel-aware response constraints */
const CHANNEL_RESPONSE_CONSTRAINTS = {
  voice: { max_words: 20, format: 'brief', one_question_at_a_time: true },
  chat: { max_words: 200, format: 'detailed', one_question_at_a_time: false }
};

function getResponseConstraints(channel) {
  return CHANNEL_RESPONSE_CONSTRAINTS[channel] || CHANNEL_RESPONSE_CONSTRAINTS.chat;
}

/** Optionally truncate reply for voice (u-5) */
function applyResponseConstraints(reply, channel) {
  const c = getResponseConstraints(channel);
  if (c.max_words && channel === 'voice') {
    const words = (reply || '').split(/\s+/);
    if (words.length > c.max_words) {
      return words.slice(0, c.max_words).join(' ') + '…';
    }
  }
  return reply;
}

/**
 * Localize reply by preferred_language (orch-7). MVP: returns as-is. Set ENABLE_RESPONSE_TRANSLATION=1
 * and wire global.translateApi for production.
 */
function localizeReply(reply, langCode) {
  if (!reply || langCode === 'en') return reply;
  if (process.env.ENABLE_RESPONSE_TRANSLATION === '1' && typeof global.translateApi === 'function') {
    try {
      return global.translateApi(reply, 'en', langCode) || reply;
    } catch (_) {
      return reply;
    }
  }
  return reply;
}

/** Build final ResponseObject with channel constraints (u-5) */
function buildResponse(result, channel, session) {
  let reply = result.reply;
  if (session?.preferred_language) {
    reply = localizeReply(reply, session.preferred_language) || reply;
  }
  reply = applyResponseConstraints(reply, channel);
  const text = channel === 'voice' ? reply : result.reply;
  return {
    reply,
    text: text || reply,
    session_id: result.session_id,
    state: result.state,
    next_chips: result.next_chips || [],
    redirect_to: result.redirect_to,
    next_step: result.next_step,
    patient_id: result.patient_id ?? session?.patient_id,
    response_constraints: getResponseConstraints(channel)
  };
}

/** Localized strings for common orchestrator prompts (maintains language after switch) */
const LOCALIZED_PROMPTS = {
  collect_date: {
    en: 'Thanks. What day should we aim for? You can reply like "today", "tomorrow", or "2026-03-20".',
    sw: 'Asante. Siku gani ifae? Unaweza kuandika "leo", "kesho", au "2026-03-20".',
    es: 'Gracias. ¿Qué día te vendría bien? Puedes decir "hoy", "mañana" o "2026-03-20".',
    ru: 'Спасибо. На какой день вам удобно? Можете написать "сегодня", "завтра" или "2026-03-20".',
    zh: '谢谢。您哪天方便？可以回复"今天"、"明天"或"2026-03-20"。',
    fr: 'Merci. Quel jour vous convient ? Vous pouvez dire "aujourd\'hui", "demain" ou "2026-03-20".',
    de: 'Danke. Welcher Tag passt Ihnen? Sie können "heute", "morgen" oder "2026-03-20" schreiben.'
  },
  collect_date_repeat: {
    en: 'Please reply with a date like "2026-03-20", or say "today" / "tomorrow".',
    sw: 'Tafadhali andika tarehe kama "2026-03-20", au sema "leo" / "kesho".',
    es: 'Por favor responde con una fecha como "2026-03-20", o di "hoy" / "mañana".',
    ru: 'Пожалуйста, напишите дату в формате "2026-03-20" или скажите "сегодня" / "завтра".',
    zh: '请回复日期如"2026-03-20"，或说"今天"/"明天"。',
    fr: 'Veuillez indiquer une date comme "2026-03-20", ou dites "aujourd\'hui" / "demain".',
    de: 'Bitte antworten Sie mit einem Datum wie "2026-03-20" oder sagen Sie "heute" / "morgen".'
  }
};

function getLocalizedPrompt(key, langCode) {
  const map = LOCALIZED_PROMPTS[key];
  if (!map) return null;
  return map[langCode] || map.en;
}

/** Language name -> code map for explicit requests (e.g. "speak Swahili") */
const LANGUAGE_NAME_TO_CODE = {
  swahili: 'sw', kiswahili: 'sw', spanish: 'es', español: 'es', english: 'en', russian: 'ru', french: 'fr',
  français: 'fr', chinese: 'zh', mandarin: 'zh', german: 'de', deutsch: 'de', arabic: 'ar', portuguese: 'pt',
  vietnamese: 'vi', hindi: 'hi', tagalog: 'tl', korean: 'ko', japanese: 'ja'
};

/**
 * Detect explicit language preference requests (Kelly prompt: "Can we speak [language]?")
 * Returns { isLanguageRequest: boolean, code?: string, name?: string }
 * Supports English patterns and common non-English phrases (e.g. Swahili "Tunaweza ongea swahili").
 */
function detectLanguagePreferenceRequest(message) {
  const m = (message || '').toString().trim();
  const lower = m.toLowerCase();

  // Swahili phrases: "Tunaweza ongea swahili" (Can we speak Swahili), "ongea Kiswahili"
  const swahiliLangPatterns = [
    { re: /(?:tunaweza|naweza|weza)\s+ongea\s+(?:ki)?swahili/i, code: 'sw', name: 'Swahili' },
    { re: /ongea\s+(?:ki)?swahili/i, code: 'sw', name: 'Swahili' }
  ];
  for (const { re, code, name } of swahiliLangPatterns) {
    if (re.test(lower)) return { isLanguageRequest: true, code, name };
  }

  // Blocklist: common words that match "in X" but are NOT languages (e.g. "rash in my eyelid")
  const NOT_LANGUAGE = new Set(['my', 'your', 'their', 'his', 'her', 'the', 'a', 'an', 'this', 'that', 'order', 'way', 'mind', 'detail', 'general', 'particular']);
  const patterns = [
    /\b(?:can you|could you|can we|could we)\s+speak\s+(?:in\s+)?(\w+)/i,
    /\bspeak\s+(?:in\s+)?(\w+)\s*(?:please)?/i,
    /\b(?:respond|reply|answer|write)\s+(?:in\s+)?(\w+)/i,
    /\bI\s+(?:don'?t\s+)?speak\s+(\w+)/i,
    /\b(?:please\s+)?(english|spanish|french|german|russian|chinese|swahili)\s+please\b/i,
    /\b(?:language|lang)\s*[:\s]?\s*(\w+)/i
  ];
  for (const re of patterns) {
    const match = lower.match(re);
    if (match && match[1]) {
      const lang = match[1].toLowerCase();
      if (NOT_LANGUAGE.has(lang)) continue;
      const code = LANGUAGE_NAME_TO_CODE[lang] || (lang.length >= 2 ? lang.substring(0, 2) : null);
      if (code) return { isLanguageRequest: true, code, name: lang };
    }
  }
  return { isLanguageRequest: false };
}

/**
 * Detect language from text (heuristic for MVP; can be replaced with LLM/translation API).
 * Returns { code, name } e.g. { code: 'es', name: 'Spanish' }
 */
function detectLanguageFromText(text) {
  const t = (text || '').toString().trim();
  if (!t) return { code: 'en', name: 'English' };

  const lower = t.toLowerCase();
  if (/\p{Script=Cyrillic}/u.test(t)) return { code: 'ru', name: 'Russian' };
  if (/\p{Script=Han}/u.test(t) || /[\u4e00-\u9fff]/.test(t)) return { code: 'zh', name: 'Chinese' };
  if (/^(hola|buenos|gracias|por favor|quiero|necesito|dolor|sí|no)\b/i.test(lower) || /español|español/i.test(lower)) return { code: 'es', name: 'Spanish' };
  if (/^(bonjour|merci|je veux|j'ai|oui|non)\b/i.test(lower) || /français|français/i.test(lower)) return { code: 'fr', name: 'French' };
  if (/^(guten|danke|ich|hallo|ja|nein)\b/i.test(lower) || /deutsch|german/i.test(lower)) return { code: 'de', name: 'German' };
  if (/\bswahili|kiswahili\b/i.test(lower)) return { code: 'sw', name: 'Swahili' };

  return { code: 'en', name: 'English' };
}

/**
 * Translate to English for canonical storage (content_english in conversation_history).
 * Set ENABLE_TRANSLATE_TO_ENGLISH=1 to use Azure/translation API when integrated.
 */
function translateToEnglish(text, langCode) {
  if (!text || langCode === 'en') return text;
  if (process.env.ENABLE_TRANSLATE_TO_ENGLISH === '1' && typeof global.translateApi === 'function') {
    try {
      return global.translateApi(text, langCode, 'en') || text;
    } catch (_) {
      return text;
    }
  }
  return text;
}

/**
 * Get or create session. Resume by session_id, caller_phone (s1-9), or patient_id (s1-7 handover).
 */
function getOrCreateSession(params) {
  const { session_id, caller_phone, patient_id, channel, clinic_id, portal_session_id } = params;
  let session = null;

  if (session_id) {
    session = db.getOrchestrateSessionBySessionId(session_id);
  }
  if (!session && caller_phone) {
    session = db.getOrchestrateSessionByCallerPhone(caller_phone);
    if (session) {
      session = { ...session, resumed_from_voice: true };
    }
  }
  if (!session && patient_id) {
    const rows = db.db.prepare('SELECT * FROM patient_orchestrate_sessions WHERE patient_id = ? AND status = ? ORDER BY last_activity_at DESC LIMIT 1').all(patient_id, 'active');
    session = rows && rows[0] ? { ...rows[0], conversation_history: rows[0].conversation_history ? JSON.parse(rows[0].conversation_history) : [], flow_state: rows[0].flow_state ? JSON.parse(rows[0].flow_state) : {} } : null;
  }

  const now = new Date().toISOString();
  const newSessionId = session_id || uuidv4();
  if (!session) {
    session = {
      id: uuidv4(),
      session_id: newSessionId,
      channel,
      patient_id: patient_id || null,
      caller_phone: caller_phone || null,
      portal_session_id: portal_session_id || null,
      clinic_id: clinic_id || null,
      preferred_language: 'en',
      turn_count: 0,
      conversation_history: [],
      flow_state: { current_state: 'collect_reason', step: 'collect_reason', reason: '', appointment_type: 'General Consult', timezone: 'America/New_York' },
      case_id: null,
      status: 'active',
      created_at: now,
      updated_at: now,
      last_activity_at: now
    };
    db.upsertOrchestrateSession({
      ...session,
      conversation_history: session.conversation_history,
      flow_state: session.flow_state
    });
  }
  return { session, session_id: session.session_id };
}

/**
 * Assess language in first 1–2 turns and set preferred_language.
 */
function assessLanguage(session, userMessage) {
  if (session.turn_count >= LANGUAGE_DETECTION_TURNS && session.preferred_language) {
    return session.preferred_language;
  }
  const detected = detectLanguageFromText(userMessage);
  const langCode = detected.code;
  db.upsertOrchestrateSession({
    session_id: session.session_id,
    channel: session.channel,
    patient_id: session.patient_id,
    caller_phone: session.caller_phone,
    clinic_id: session.clinic_id,
    preferred_language: langCode,
    turn_count: session.turn_count,
    conversation_history: session.conversation_history,
    flow_state: session.flow_state,
    status: session.status
  });
  return langCode;
}

/**
 * Map RAG output to orchestrator intent and specialty (Phase 1 — RAG wiring).
 * @param {{ icd10: Array<{code,description,confidence}>, cpt: Array }} ragCandidates
 * @param {string} message - User message
 * @returns {{ intent: string, specialty?: string }}
 */
function ragToIntent(ragCandidates, message) {
  const msg = (message || '').toLowerCase().trim();
  const hasInsurance = /\b(insurance|coverage|eligibility|member\s*id|check\s*my\s*insurance|verify\s*insurance)\b/i.test(msg);
  const hasUpload = /\b(upload|photo|picture|image|send\s+(you\s+)?(a\s+)?(photo|pic|picture)|rash|skin\s+issue|show\s+you)\b/i.test(msg);
  if (/\b(upload|send)\s+(my\s+)?(insurance\s+card|card)\b/i.test(msg) || /\binsurance\s+card\s*(upload|photo)?\b/i.test(msg)) {
    return { intent: 'upload' };
  }
  if (hasInsurance && !hasUpload) return { intent: 'insurance' };
  if (hasUpload) return { intent: 'upload' };
  const icd10 = ragCandidates?.icd10 || [];
  const topCode = icd10[0]?.code || '';
  const prefix = topCode.substring(0, 1);
  const prefix2 = topCode.substring(0, 3);
  if (prefix === 'F') return { intent: 'collect_reason', specialty: 'mental_health' };
  if (prefix === 'I' || /^I\d/.test(topCode)) return { intent: 'collect_reason', specialty: 'cardiology' };
  if (prefix === 'Z') return { intent: 'collect_reason', specialty: 'general' };
  if (/^[EK]/.test(prefix) || prefix2 === 'E11' || prefix2 === 'E10') return { intent: 'collect_reason', specialty: 'internal' };
  return { intent: 'collect_reason', specialty: 'general' };
}

/**
 * Append turn with original + English translation (s1-8).
 * HIPAA: Redact SSN, DOB, card numbers from user content before storing.
 */
function appendTurn(session, role, content, contentEnglish) {
  const history = session.conversation_history || [];
  const en = contentEnglish !== undefined ? contentEnglish : (role === 'user' ? translateToEnglish(content, session.preferred_language) : content);
  const toStore = (str) => (piiRedactor?.redact && typeof str === 'string' ? piiRedactor.redact(str) : str);
  history.push({
    role,
    content: role === 'user' ? toStore(content) : content,
    content_english: role === 'user' ? toStore(en) : en,
    timestamp: Date.now()
  });
  const capped = history.slice(-50);
  session.conversation_history = capped;
  session.turn_count = capped.filter(h => h.role === 'user').length;
  return capped;
}

/**
 * Main orchestrate entry point.
 * @param {Object} input
 * @param {'voice'|'chat'} input.channel
 * @param {string} input.transcript_or_message — user's message
 * @param {string} [input.session_id]
 * @param {string} [input.patient_id]
 * @param {string} [input.caller_phone] — for voice, enables resume on callback
 * @param {string} [input.clinic_id]
 * @param {string} [input.portal_session_id]
 * @param {Object} [input.meta] — chip actions etc.
 * @returns {Promise<{ reply, session_id, state, next_chips, redirect_to, text }>}
 */
async function orchestrate(input) {
  const {
    channel,
    transcript_or_message,
    session_id,
    patient_id,
    caller_phone,
    clinic_id,
    portal_session_id,
    meta = {}
  } = input;

  const message = (transcript_or_message || '').toString().trim();
  if (!message && !meta.action) {
    return buildResponse({ reply: 'How can I help you today?', session_id: session_id || uuidv4(), state: {}, next_chips: [] }, channel || 'chat', null);
  }

  const { session } = getOrCreateSession({
    session_id,
    caller_phone,
    patient_id,
    channel: channel || 'chat',
    clinic_id,
    portal_session_id
  });

  session.preferred_language = assessLanguage(session, message);

  appendTurn(session, 'user', message);

  const state = session.flow_state || { current_state: 'collect_reason', step: 'collect_reason', reason: '', appointment_type: 'General Consult', timezone: 'America/New_York' };
  if (!state.current_state) state.current_state = state.step || 'collect_reason';

  // Phase 3.2: Generate case number at first meaningful turn (turn_count === 1)
  if (session.turn_count === 1 && !state.case_id && db.createCaseRecord) {
    try {
      const caseNumber = `CR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      db.createCaseRecord({
        id: uuidv4(),
        case_number: caseNumber,
        session_id: session.session_id,
        channel,
        status: 'draft'
      });
      state.case_id = caseNumber;
    } catch (e) {
      console.warn('[orchestrator] createCaseRecord failed:', e?.message || e);
    }
  }

  const BookingService = require('./booking-service');
  const assessment = detectRedFlags(message);
  if (assessment?.isEmergency) {
    state.blocked = true;
    state.is_emergency = true;
    try {
      if (db.upsertPatientEmergencyFlag) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.upsertPatientEmergencyFlag({
          patient_id: session.patient_id || null,
          email: input.patient_email || null,
          phone: session.caller_phone || null,
          source: channel === 'voice' ? 'voice' : 'web',
          call_id: channel === 'voice' ? input.session_id : null,
          expires_at: expiresAt,
          metadata: { red_flags: assessment.redFlags || [], urgency: assessment.urgency || 'EMERGENT' }
        });
      }
    } catch (e) {
      console.warn('[orchestrator] upsertPatientEmergencyFlag failed:', e?.message || e);
    }
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    appendTurn(session, 'assistant', assessment.suggestedResponse || 'This may be an emergency. Please call 911 or go to the nearest ER now.');
    return buildResponse({
      reply: assessment.suggestedResponse || 'This may be an emergency. Please call 911 or go to the nearest ER now.',
      session_id: session.session_id,
      state,
      next_chips: []
    }, channel, session);
  }

  /** Language-preference intent (Kelly prompt: "Can we speak [language]?") — handle BEFORE treating message as visit reason */
  const langPref = detectLanguagePreferenceRequest(message);
  if (langPref.isLanguageRequest && langPref.code) {
    session.preferred_language = langPref.code;
    const chips = channel === 'chat' ? [
      { label: 'Book a general visit', value: 'I want to book a general visit' },
      { label: 'I have symptoms', value: 'I have symptoms' },
      { label: 'Billing / receipt', value: 'I need help with my receipt', action: 'billing' }
    ] : [];
    const replyMap = {
      sw: "Karibu! Nitaweza kusaidia kwa Kiswahili kadri uwezavyo. Ninaweza kukusaidia nini leo? Ikiwa hii ni dharura, tafadhali piga 911 au kwenda hospitali ya karibu.",
      es: "¡Por supuesto! Responderé en español. ¿En qué puedo ayudarte hoy? Si esto es una emergencia, llama al 911 o ve a la sala de emergencias más cercana.",
      ru: "Конечно! Я буду отвечать по-русски. Чем могу помочь сегодня? Если это экстренная ситуация, позвоните 911 или обратитесь в ближайшее отделение скорой помощи.",
      zh: "当然！我会用中文回复。今天我能帮您什么？如果这是紧急情况，请拨打911或前往最近的急诊室。",
      fr: "Bien sûr ! Je répondrai en français. Comment puis-je vous aider aujourd'hui ? En cas d'urgence, appelez le 911 ou rendez-vous aux urgences.",
      de: "Natürlich! Ich werde auf Deutsch antworten. Womit kann ich Ihnen heute helfen? Bei einem Notfall rufen Sie bitte 911 an oder gehen Sie zur nächsten Notaufnahme."
    };
    const displayName = langPref.name || ({ my: 'Burmese', zh: 'Chinese', es: 'Spanish', sw: 'Swahili', ru: 'Russian', fr: 'French', de: 'German' })[langPref.code] || langPref.code;
    const reply = replyMap[langPref.code] || `Sure, I'll respond in ${displayName} when I can. What can we help you with today? If this feels like an emergency, please call 911 or go to the nearest ER.`;
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: chips }, channel, session);
  }

  /** Phase 1: RAG intent resolver — replace regex with knowledge-service */
  let ragCandidates = { icd10: [], cpt: [], hcpcs: [] };
  try {
    ragCandidates = await knowledgeService.getCodeCandidates(message, {
      maxIcd10: 5,
      maxCpt: 3,
      clinicId: clinic_id || null,
      callId: session_id || null
    });
  } catch (e) {
    console.warn('[orchestrator] RAG fallback:', e.message);
  }
  const { intent: ragIntent, specialty: ragSpecialty } = ragToIntent(ragCandidates, message);
  if (ragSpecialty && !state.rag_specialty) state.rag_specialty = ragSpecialty;

  /** u-7: Upload intent — from RAG/ragToIntent */
  if (ragIntent === 'upload' && !state.upload_link_sent) {
    state.upload_requested = true;
    let reply;
    if (channel === 'voice') {
      const callerPhone = session.caller_phone || input.caller_phone;
      if (callerPhone) {
        try {
          const { createAndSendUploadLink } = require('../routes/patient-upload-link');
          const linkResult = await createAndSendUploadLink({
            patient_id: session.patient_id || input.patient_id,
            patient_phone: callerPhone,
            appointment_id: state.appointment_id || null,
            channel: 'sms'
          });
          if (linkResult.sent) {
            state.upload_link_sent = true;
            reply = "I've texted you a link to upload your photo. Use it within 48 hours.";
          } else {
            reply = "I couldn't send the link to your phone. Please use our web portal to upload—I'll add a link in the chat.";
          }
        } catch (_) {
          reply = "Please use our web portal to upload. Go to My Records and upload there.";
        }
      } else {
        reply = "I need your phone number to text you an upload link. Or use our web portal at My Records to upload.";
      }
    } else {
      reply = "You can upload your photo below. Use the upload area or go to My Records.";
    }
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({
      reply,
      session_id: session.session_id,
      state,
      next_chips: [],
      next_step: 'UPLOAD_IMAGE'
    }, channel, session);
  }

  /** Insurance intent — from RAG/ragToIntent. Skip if user says they don't have insurance. */
  const noInsurancePhrase = /\b(no\s+insurance|don'?t\s+have\s+insurance|uninsured|without\s+insurance|self[- ]?pay|pay\s+out\s+of\s+pocket)\b/i.test(message);
  if (ragIntent === 'insurance' && !state.insurance_started) {
    if (noInsurancePhrase) {
      const reply = channel === 'voice' ? "No problem. What brings you in today?" : "No problem. What brings you in today?";
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id, channel: session.channel, patient_id: session.patient_id,
        caller_phone: session.caller_phone, clinic_id: session.clinic_id,
        preferred_language: session.preferred_language, turn_count: session.turn_count,
        conversation_history: session.conversation_history, flow_state: state, status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    state.insurance_started = true;
    state.current_state = 'collect_insurance_member_id';
    state.step = 'collect_insurance_member_id';
    const reply = channel === 'voice' ? 'I can check your insurance. What is your member ID?' : 'I can check your insurance coverage. Please enter your insurance member ID (usually on your card).';
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  if (state.step === 'collect_insurance_member_id') {
    if (noInsurancePhrase || /^(skip|no|never mind)$/i.test((message || '').trim())) {
      state.step = 'collect_reason';
      state.current_state = 'collect_reason';
      state.insurance_started = false;
      const reply = channel === 'voice' ? "No problem. What brings you in today?" : "No problem. What brings you in today?";
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id, channel: session.channel, patient_id: session.patient_id,
        caller_phone: session.caller_phone, clinic_id: session.clinic_id,
        preferred_language: session.preferred_language, turn_count: session.turn_count,
        conversation_history: session.conversation_history, flow_state: state, status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    const memberId = (message || '').replace(/\D/g, '').length >= 6 ? message.trim() : null;
    if (!memberId) {
      const reply = 'Please provide your insurance member ID. It\'s usually 8-12 digits on your insurance card.';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    state.insurance_member_id = memberId;
    state.step = 'collect_insurance_payer';
    state.current_state = 'collect_insurance_payer';
    const reply = 'Thanks. What is your insurance company name? For example, Blue Cross or Aetna.';
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  if (state.step === 'collect_insurance_payer') {
    if (noInsurancePhrase || /^(skip|no|never mind)$/i.test((message || '').trim())) {
      state.step = 'collect_reason';
      state.current_state = 'collect_reason';
      state.insurance_started = false;
      const reply = channel === 'voice' ? "No problem. What brings you in today?" : "No problem. What brings you in today?";
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id, channel: session.channel, patient_id: session.patient_id,
        caller_phone: session.caller_phone, clinic_id: session.clinic_id,
        preferred_language: session.preferred_language, turn_count: session.turn_count,
        conversation_history: session.conversation_history, flow_state: state, status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    const payerName = (message || '').trim();
    if (!payerName || payerName.length < 2) {
      const reply = 'Please tell me your insurance company name.';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    state.insurance_payer_name = payerName;
    try {
      const InsuranceService = require('./insurance-service');
      const PayerCacheService = require('./payer-cache-service');
      let payerId = state.insurance_payer_id || null;
      if (!payerId && payerName) {
        try {
          const payerSearch = await PayerCacheService.searchPayer(payerName);
          const payers = payerSearch?.payers || payerSearch;
          payerId = Array.isArray(payers) && payers[0] ? (payers[0].payer_id || payers[0].id) : null;
        } catch (e) {
          console.warn('[orchestrator] PayerCacheService.searchPayer failed:', e?.message || e);
        }
        if (!payerId) {
          const insSearch = await InsuranceService.searchPayer(payerName);
          const arr = insSearch?.payers || (Array.isArray(insSearch) ? insSearch : []);
          payerId = arr[0] ? (arr[0].payer_id || arr[0].id) : null;
        }
      }
      let patientName = state.patient_name || 'Patient';
      let patientDob = state.patient_dob || '1990-01-01';
      const pid = session.patient_id || input.patient_id;
      if (pid && db.getFHIRPatient) {
        try {
          const fhirRow = db.getFHIRPatient(pid);
          const resource = fhirRow?.resource_data ? (typeof fhirRow.resource_data === 'string' ? JSON.parse(fhirRow.resource_data) : fhirRow.resource_data) : null;
          if (resource) {
            const name = resource.name?.[0];
            if (name) patientName = [].concat(name.given || [], name.family || []).filter(Boolean).join(' ') || patientName;
            if (resource.birthDate) patientDob = String(resource.birthDate);
          }
        } catch (e) {
          console.warn('[orchestrator] getFHIRPatient parse failed:', e?.message || e);
        }
      }
      const eligibilityData = {
        patientName,
        dateOfBirth: patientDob,
        memberId: state.insurance_member_id,
        payerId: payerId || 'BCBS',
        serviceCode: '99213',
        dateOfService: new Date().toISOString().slice(0, 10),
        patientId: session.patient_id || input.patient_id
      };
      const eligResult = await InsuranceService.checkEligibility(eligibilityData);
      // Phase 5: Save insurance info for patient when they have it
      if (pid && db.upsertPatientInsurance) {
        try {
          db.upsertPatientInsurance({
            id: `pi-${uuidv4()}`,
            patient_id: pid,
            payer_id: payerId || 'BCBS',
            payer_name: state.insurance_payer_name || payerName,
            member_id: state.insurance_member_id,
            is_primary: 1,
            is_verified: eligResult?.eligible ? 1 : 0
          });
        } catch (e) {
          console.warn('[orchestrator] upsertInsuranceMember failed:', e?.message || e);
        }
      }
      const summary = eligResult?.eligible
        ? `You're eligible. Copay: $${(eligResult.copay ?? eligResult.copay_amount ?? 0).toFixed(2)}.`
        : (eligResult?.message || 'Eligibility check completed. I can share details in your patient portal.');
      state.step = 'collect_reason';
      state.current_state = 'collect_reason';
      state.insurance_started = false;
      appendTurn(session, 'assistant', summary);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply: summary, session_id: session.session_id, state, next_chips: [] }, channel, session);
    } catch (e) {
      const { sanitizeErrorMessage } = require('./payment-security');
      const reply = `Sorry, I couldn't check eligibility right now. ${sanitizeErrorMessage(e?.message, 'Please try again or use our web portal.')}`;
      appendTurn(session, 'assistant', reply);
      state.step = 'collect_reason';
      state.current_state = 'collect_reason';
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
  }

  if (meta.action === 'billing') {
    appendTurn(session, 'assistant', 'For receipts and payments, open Wallet. You can pay any balance due from there.');
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({
      reply: 'For receipts and payments, open Wallet. You can pay any balance due from there.',
      session_id: session.session_id,
      state,
      next_chips: [],
      redirect_to: 'wallet.html'
    }, channel, session);
  }

  function parseIsoDateFromText(text) {
    const t = (text || '').toString();
    const m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return m[0];
    const lower = t.toLowerCase();
    if (lower.includes('tomorrow')) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    if (lower.includes('today')) return new Date().toISOString().slice(0, 10);
    return null;
  }

  function parseTimeFromText(text) {
    const t = (text || '').toString().toLowerCase();
    const m24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m24) return `${m24[1].padStart(2, '0')}:${m24[2]}`;
    const m12 = t.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
    if (m12) {
      let h = parseInt(m12[1], 10);
      const min = m12[2] ? parseInt(m12[2], 10) : 0;
      const ampm = m12[3];
      if (ampm === 'pm' && h !== 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return null;
  }

  /** OPQRST sub-flow: collect_reason → opqrst_onset → opqrst_quality → opqrst_severity → opqrst_time → collect_date */
  if (state.step === 'collect_reason') {
    state.reason = message;
    const msgLower = (message || '').toString().toLowerCase();
    const skipOpqrst = meta?.skip_opqrst || /\b(skip|just book|checkup|routine|general visit)\b/i.test(message)
      || /\b(?:want to|wanna|need to|like to|could i|can i)?\s*(?:see|talk to|speak with)\s+(?:a\s+)?doctor\b/i.test(message)
      || /\b(?:see|talk to|speak with)\s+(?:a\s+)?doctor\b/i.test(message)
      || /\b(?:book|schedule)\s+(?:a\s+|an\s+)?(?:visit|appointment)\b/i.test(message)
      || /\b(?:can i|could i|i(?:'d)? like to)\s+(?:book|schedule)\s+(?:a\s+|an\s+)?(?:visit|appointment)\b/i.test(message)
      || /nataka\s+kuo(ngea|na)\s+(?:na\s+)?daktari|kuona\s+daktari|kuongea\s+na\s+daktari/i.test(msgLower)
      || /quiero\s+(?:ver|hablar\s+con)\s+(?:a\s+)?(?:un\s+)?médico|quiero\s+una\s+cita/i.test(msgLower)
      || /(?:我要|我想)\s*(?:看医生|预约|见医生)/i.test(message)
      || /(?:хочу|записаться)\s+(?:к\s+)?врачу/i.test(msgLower);
    if (skipOpqrst) {
      state.visit_mode = 'sync_video';
      state.step = 'collect_date';
      state.current_state = 'collect_date';
      const reply = getLocalizedPrompt('collect_date', session.preferred_language) || 'Thanks. What day should we aim for? You can reply like "today", "tomorrow", or "2026-03-20".';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    state.opqrst = state.opqrst || {};
    state.step = 'opqrst_onset';
    state.current_state = 'opqrst_onset';
    const reply = channel === 'voice' ? "When did it start?" : "Thanks. When did the symptoms start? For example, 'a few days ago' or 'this morning'.";
    appendTurn(session, 'assistant', reply);
    const onsetChips = channel === 'chat' ? [{ label: 'Skip to scheduling', value: 'skip', action: 'skip_opqrst' }] : [];
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: onsetChips }, channel, session);
  }

  if (meta.action === 'skip_opqrst' && /^opqrst_/.test(state.step || '')) {
    state.visit_mode = 'sync_video';
    state.step = 'collect_date';
    state.current_state = 'collect_date';
    const reply = getLocalizedPrompt('collect_date', session.preferred_language) || 'Thanks. What day should we aim for? You can reply like "today", "tomorrow", or "2026-03-20".';
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  if (state.step === 'opqrst_onset') {
    state.opqrst = state.opqrst || {};
    state.opqrst.onset = message;
    state.step = 'opqrst_quality';
    state.current_state = 'opqrst_quality';
    const reply = channel === 'voice' ? "What does it feel like?" : "What does it feel like? For example, sharp, dull, aching, or burning.";
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  if (state.step === 'opqrst_quality') {
    state.opqrst = state.opqrst || {};
    state.opqrst.quality = message;
    state.step = 'opqrst_severity';
    state.current_state = 'opqrst_severity';
    const reply = channel === 'voice' ? "On a scale of 1 to 10, how bad is it?" : "On a scale of 1 to 10, how severe is it?";
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  if (state.step === 'opqrst_severity') {
    state.opqrst = state.opqrst || {};
    state.opqrst.severity = message;
    state.step = 'opqrst_time';
    state.current_state = 'opqrst_time';
    const reply = channel === 'voice' ? "How long does it last each time?" : "How long does it last when it happens? For example, 'a few minutes' or 'constant'.";
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  if (state.step === 'opqrst_time') {
    state.opqrst = state.opqrst || {};
    state.opqrst.time = message;
    state.step = 'choose_lane';
    state.current_state = 'choose_lane';
    try {
      const opqrstText = [state.opqrst.onset, state.opqrst.quality, state.opqrst.severity, state.opqrst.time, state.reason]
        .filter(Boolean).join(' ');
      const icdCandidates = await knowledgeService.getCodeCandidates(opqrstText, {
        maxIcd10: 3,
        clinicId: clinic_id || session.clinic_id || null,
        callId: session_id || null
      });
      state.suggested_icd10 = icdCandidates?.icd10?.[0]?.code || null;
    } catch (e) {
      console.warn('[orchestrator] getCodeCandidates failed:', e?.message || e);
    }
    const reply = channel === 'voice'
      ? "Do you need to see a doctor now on video, or can a specialist review your case within a few hours?"
      : "How would you like to proceed?";
    const laneChips = channel === 'chat'
      ? [
          { label: 'Video now', value: 'Video now', action: 'select_lane', visit_mode: 'sync_video' },
          { label: 'Async review', value: 'Async review', action: 'select_lane', visit_mode: 'async_review' }
        ]
      : [];
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: laneChips }, channel, session);
  }

  /** choose_lane: store visit_mode, then collect_date */
  if (state.step === 'choose_lane') {
    const selectedMode = (meta?.action === 'select_lane' && meta?.visit_mode) ? meta.visit_mode : (meta?.visit_mode || (
      /(async|review|few hours|within hours)/i.test(message) ? 'async_review' :
      /(video|now|today|live)/i.test(message) ? 'sync_video' : null
    ));
    if (!selectedMode) {
      const reply = channel === 'voice'
        ? "Say 'video now' for a live visit, or 'async review' for a specialist to review within a few hours."
        : "Please choose Video now or Async review.";
      const chips = channel === 'chat' ? [
        { label: 'Video now', value: 'Video now', action: 'select_lane', visit_mode: 'sync_video' },
        { label: 'Async review', value: 'Async review', action: 'select_lane', visit_mode: 'async_review' }
      ] : [];
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: chips }, channel, session);
    }
    state.visit_mode = selectedMode;
    state.step = 'collect_date';
    state.current_state = 'collect_date';
    const reply = getLocalizedPrompt('collect_date', session.preferred_language) || 'Thanks. What day should we aim for? You can reply like "today", "tomorrow", or "2026-03-20".';
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
  }

  /** K-1: collect_intake - DOB, country, city before choose_time */
  if (state.step === 'collect_intake') {
    const pid = session.patient_id || patient_id;
    if (!pid) {
      state.step = 'choose_time';
      state.current_state = 'choose_time';
      state.date = state.pending_intake_date || state.date;
    } else {
      const PatientIntakeService = require('./patient-intake-service');
      const payload = {};
      const dobMatch = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) || message.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
      if (dobMatch) {
        if (dobMatch[0].includes('-')) payload.dob = dobMatch[0];
        else payload.dob = `${dobMatch[3].length === 2 ? '20' + dobMatch[3] : dobMatch[3]}-${dobMatch[1].padStart(2,'0')}-${dobMatch[2].padStart(2,'0')}`;
      }
      const stage = state.collect_intake_stage || 'dob';
      if (stage === 'country' && message.trim().length >= 2) payload.country = message.trim().slice(0, 100);
      if (stage === 'city' && message.trim().length >= 2) payload.city = message.trim().slice(0, 100);
      if (!payload.dob && !payload.country && !payload.city) {
        const words = (message || '').split(/\s+/).filter(Boolean);
        if (words.length >= 1) {
          const last = words[words.length - 1];
          if (/^[A-Za-z]{2,}$/.test(last) && last.length < 30 && stage === 'dob') payload.city = last;
          else if (stage === 'country') payload.country = message.trim().slice(0, 100);
          else if (stage === 'city') payload.city = message.trim().slice(0, 100);
        }
      }
      if (Object.keys(payload).length > 0) {
        try {
          await PatientIntakeService.upsertIntakeByPatientId(pid, payload);
        } catch (e) {
          console.warn('[orchestrator] upsertIntakeByPatientId failed:', e?.message || e);
        }
      }
      const nextStatus = PatientIntakeService.getIntakeStatusByPatientId(pid);
      if (nextStatus.onboarding_complete) {
        state.step = 'choose_time';
        state.current_state = 'choose_time';
        state.date = state.pending_intake_date || state.date;
        delete state.pending_intake_date;
        delete state.collect_intake_stage;
        const clinicId = clinic_id || session.clinic_id || process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID;
        let slots = [];
        try {
          const result = await BookingService.getAvailableSlots(state.date, null, state.appointment_type || 'General Consult', state.timezone || 'America/New_York', clinicId, null);
          slots = (result?.slots || result?.available_slots || []).slice(0, 6);
        } catch (e) {
          console.warn('[orchestrator] getAvailableSlots failed:', e?.message || e);
        }
        const chips = slots.map(s => {
          const label = s.display || s.time || s.start_time || s.start || s;
          return { label, value: String(label), action: 'select_slot', slot: s };
        });
        const reply = chips.length ? 'Thanks. Here are some available times. Pick one.' : 'No slots found for that day. Try another date.';
        appendTurn(session, 'assistant', reply);
        db.upsertOrchestrateSession({
          session_id: session.session_id, channel: session.channel, patient_id: session.patient_id,
          caller_phone: session.caller_phone, clinic_id: session.clinic_id,
          preferred_language: session.preferred_language, turn_count: session.turn_count,
          conversation_history: session.conversation_history, flow_state: state, status: session.status
        });
        return buildResponse({ reply, session_id: session.session_id, state, next_chips: chips }, channel, session);
      } else {
        const stillMissing = nextStatus.missing_fields || [];
        let reply;
        if (stillMissing.includes('dob')) {
          reply = "What's your date of birth? (e.g. 1990-01-15)";
          state.collect_intake_stage = 'dob';
        } else if (stillMissing.includes('country')) {
          reply = 'What country do you live in?';
          state.collect_intake_stage = 'country';
        } else if (stillMissing.includes('city')) {
          reply = 'What city do you live in?';
          state.collect_intake_stage = 'city';
        } else {
          state.step = 'choose_time';
          state.current_state = 'choose_time';
          state.date = state.pending_intake_date || state.date;
          delete state.pending_intake_date;
          reply = "Thanks. Here are some available times.";
        }
        if (state.step !== 'choose_time') {
          appendTurn(session, 'assistant', reply);
          db.upsertOrchestrateSession({
            session_id: session.session_id, channel: session.channel, patient_id: session.patient_id,
            caller_phone: session.caller_phone, clinic_id: session.clinic_id,
            preferred_language: session.preferred_language, turn_count: session.turn_count,
            conversation_history: session.conversation_history, flow_state: state, status: session.status
          });
          return buildResponse({ reply, session_id: session.session_id, state, next_chips: [], needs_intake: true, missing_fields: stillMissing }, channel, session);
        }
      }
    }
  }

  if (state.step === 'collect_date') {
    const iso = parseIsoDateFromText(message);
    if (!iso) {
      const reply = getLocalizedPrompt('collect_date_repeat', session.preferred_language) || 'Please reply with a date like "2026-03-20", or say "today" / "tomorrow".';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    state.date = iso;
    // K-1: Check intake status before showing slots (voice: get_patient_intake_status; chat: inline)
    const pid = session.patient_id || patient_id;
    if (pid) {
      try {
        const PatientIntakeService = require('./patient-intake-service');
        const intakeStatus = PatientIntakeService.getIntakeStatusByPatientId(pid);
        if (!intakeStatus.onboarding_complete && intakeStatus.missing_fields?.length) {
          const missing = intakeStatus.missing_fields;
          const prompts = [];
          if (missing.includes('dob')) prompts.push('date of birth');
          if (missing.includes('country')) prompts.push('country');
          if (missing.includes('city')) prompts.push('city');
          if (prompts.length > 0) {
            state.step = 'collect_intake';
            state.current_state = 'collect_intake';
            state.pending_intake_date = iso;
            const reply = `Before I show you times, I need: ${prompts.join(', ')}. What's your date of birth?`;
            appendTurn(session, 'assistant', reply);
            db.upsertOrchestrateSession({
              session_id: session.session_id, channel: session.channel, patient_id: session.patient_id,
              caller_phone: session.caller_phone, clinic_id: session.clinic_id,
              preferred_language: session.preferred_language, turn_count: session.turn_count,
              conversation_history: session.conversation_history, flow_state: state, status: session.status
            });
            return buildResponse({
              reply,
              session_id: session.session_id,
              state,
              next_chips: [],
              needs_intake: true,
              missing_fields: intakeStatus.missing_fields
            }, channel, session);
          }
        }
      } catch (e) {
        console.warn('[orchestrator] getIntakeStatusByPatientId failed:', e?.message || e);
      }
    }
    state.step = 'choose_time';
    state.current_state = 'choose_time';
    const clinicId = clinic_id || session.clinic_id || process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID;
    let slots = [];
    try {
      const result = await BookingService.getAvailableSlots(state.date, null, state.appointment_type || 'General Consult', state.timezone || 'America/New_York', clinicId, null);
      slots = (result?.slots || result?.available_slots || []).slice(0, 6);
    } catch (e) {
      console.warn('[orchestrator] getAvailableSlots failed:', e?.message || e);
    }
    const chips = slots.map(s => {
      const label = s.display || s.time || s.start_time || s.start || s;
      return { label, value: String(label), action: 'select_slot', slot: s };
    });
    const reply = chips.length ? 'Here are some available times. Pick one.' : 'No slots found for that day. Try another date.';
    appendTurn(session, 'assistant', reply);
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
    return buildResponse({ reply, session_id: session.session_id, state, next_chips: chips }, channel, session);
  }

  if (state.step === 'choose_time') {
    const chosen = meta?.slot || null;
    const normalizedTime = chosen && (chosen.time || chosen.start_time || chosen.start);
    const time = normalizedTime || parseTimeFromText(message);
    if (!time) {
      const reply = 'Please choose a time (for example "2:30pm" or "14:30"), or tap one of the options.';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    state.time = time;
    state.step = 'booking';
    state.current_state = 'booking';
    db.upsertOrchestrateSession({
      session_id: session.session_id,
      channel: session.channel,
      patient_id: session.patient_id,
      caller_phone: session.caller_phone,
      clinic_id: session.clinic_id,
      preferred_language: session.preferred_language,
      turn_count: session.turn_count,
      conversation_history: session.conversation_history,
      flow_state: state,
      status: session.status
    });
  }

  if (state.step === 'booking' && !input.patient_email && !state.patient_email) {
    const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) state.patient_email = emailMatch[0];
  }

  if (state.step === 'booking') {
    const clinicId = clinic_id || session.clinic_id || process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID;
    if (!clinicId) {
      const reply = 'Unable to book right now. Please try again.';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
    const patientPhone = session.caller_phone || null;
    const patientEmail = input.patient_email || state.patient_email || null;
    if (!patientEmail) {
      const reply = channel === 'voice' ? 'To complete the booking, I need your email. Can you share it?' : 'Your session is missing an email. Please sign in again.';
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({
        reply,
        session_id: session.session_id,
        state,
        next_chips: [],
        redirect_to: channel === 'chat' ? 'patient-login.html' : undefined
      }, channel, session);
    }

    try {
      const booked = await BookingService.scheduleAppointment({
        clinic_id: clinicId,
        patient_name: state.patient_name || 'Patient',
        patient_phone: patientPhone,
        patient_email: patientEmail,
        appointment_type: state.appointment_type || 'General Consult',
        date: state.date,
        time: state.time,
        timezone: state.timezone || 'America/New_York',
        notes: state.reason || null,
        patient_id: patient_id || session.patient_id || null
      });
      if (!booked.success) {
        state.step = 'collect_date';
        const reply = booked.error || 'Could not book that time. Try another date.';
        appendTurn(session, 'assistant', reply);
        db.upsertOrchestrateSession({
          session_id: session.session_id,
          channel: session.channel,
          patient_id: session.patient_id,
          caller_phone: session.caller_phone,
          clinic_id: session.clinic_id,
          preferred_language: session.preferred_language,
          turn_count: session.turn_count,
          conversation_history: session.conversation_history,
          flow_state: state,
          status: session.status
        });
        return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
      }
      state.step = 'done';
      state.current_state = 'done';
      state.appointment_id = booked.appointment?.id;

      // Auto-checkout (align with voice): create checkout so wallet shows "Pay now"
      if (booked.appointment?.id && clinicId) {
        try {
          const axios = require('axios');
          const base = process.env.API_BASE_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
          const checkoutRes = await axios.post(`${base}/voice/appointments/checkout`, {
            appointment_id: booked.appointment.id,
            patient_phone: patientPhone || booked.appointment.patient_phone,
            patient_email: patientEmail || booked.appointment.patient_email,
            patient_name: state.patient_name || booked.appointment.patient_name || 'Patient',
            clinic_id: clinicId,
            appointment_type: state.appointment_type || 'General Consult'
          }, { timeout: 10000 });
          if (checkoutRes.data?.success) {
            booked.checkout = {
              checkout_id: checkoutRes.data.checkout_id,
              payment_token: checkoutRes.data.payment_token,
              amount: checkoutRes.data.amount,
              requires_verification: !!checkoutRes.data.requires_verification
            };
          }
        } catch (e) {
          console.warn('[orchestrator] Auto-checkout failed (wallet will create on demand):', e.message);
        }
      }

      const reply = `You're booked for ${booked.appointment?.date} at ${booked.appointment?.time}. Next, we'll take you to Wallet to complete payment if needed.`;
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: 'completed'
      });
      return buildResponse({
        reply,
        session_id: session.session_id,
        state,
        next_chips: [],
        redirect_to: 'wallet.html'
      }, channel, session);
    } catch (e) {
      const { sanitizeErrorMessage } = require('./payment-security');
      const reply = sanitizeErrorMessage(e?.message, 'Something went wrong. Please try again.');
      appendTurn(session, 'assistant', reply);
      db.upsertOrchestrateSession({
        session_id: session.session_id,
        channel: session.channel,
        patient_id: session.patient_id,
        caller_phone: session.caller_phone,
        clinic_id: session.clinic_id,
        preferred_language: session.preferred_language,
        turn_count: session.turn_count,
        conversation_history: session.conversation_history,
        flow_state: state,
        status: session.status
      });
      return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
    }
  }

  const reply = 'Tell me what you need help with, and we\'ll book a visit.';
  appendTurn(session, 'assistant', reply);
  db.upsertOrchestrateSession({
    session_id: session.session_id,
    channel: session.channel,
    patient_id: session.patient_id,
    caller_phone: session.caller_phone,
    clinic_id: session.clinic_id,
    preferred_language: session.preferred_language,
    turn_count: session.turn_count,
    conversation_history: session.conversation_history,
    flow_state: state,
    status: session.status
  });
  return buildResponse({ reply, session_id: session.session_id, state, next_chips: [] }, channel, session);
}

module.exports = {
  orchestrate,
  getOrCreateSession,
  assessLanguage,
  detectLanguageFromText,
  detectLanguagePreferenceRequest,
  LANGUAGE_DETECTION_TURNS
};
