import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getOrCreateLandingSessionId,
  fetchBarcodeFactsAutodetect,
  fetchLandingResultSnapshot,
  incrementLandingVoiceMetric,
  publishLandingVoiceTimeline,
  publishLandingThreadEvent,
  resolveMiddlewareApiBase,
  submitLandingResultEdit,
  sendLandingAssistantTurn
} from './landingAssistantApi';
import { publishVisionCaptureEvent } from './landingLiveKitApi';
import {
  speakAssistantReply,
  stopAssistantSpeech,
  waitForAssistantSpeechToFinish,
  primeAssistantAudioGate
} from './assistantSpeech';
import { createWebVoiceTurnController } from './webVoiceTurnController';
import { resolveTryNowVoiceConfig } from './tryNowVoiceConfig';
import { buildScanQuality } from './scanQuality';
import {
  buildFollowupMessageWithPinnedContext,
  buildPinnedContextText,
  compareProducts,
  deriveCategoryRoute,
  deriveIngredientFlags,
  isSparseProductData,
  pickFirstProductImageUrl,
  resolveServerCategoryRoute,
  serializeBarcodeNotFoundForThread,
  serializeObfProductForThread
} from './scanInsights';
import { prependManualIngredientGuard } from './manualIngredientGuard';
import { isProductTrackingIntent } from './productScanIntent';

const ASSISTANT_FIRST_ENABLED =
  String(process.env.REACT_APP_TRYNOW_ASSISTANT_FIRST || '1').trim().toLowerCase() !== '0';

const TRY_NOW_COPY = {
  en: {
    opener: "Hi, I'm Kelly. I'll be your Skin & Care assistant today. How can I help?",
    micReady: "I'm listening. Tell me what you'd like help with.",
    attachImage: 'Thanks, I received your image. What should I focus on?',
    attachDoc: 'Thanks, I received your file. What should I focus on from this document?',
    demoMode: 'This demo is not connected to the live API. Set REACT_APP_API_BASE to your middleware URL (for example, http://localhost:4000) for live replies.',
    voiceUnsupported: 'Voice input is not supported in this browser. Open chat to type your message.',
    genericFallback: 'I am here. How can I help?',
    networkErrorPrefix: 'Sorry, I could not reach the assistant just now.',
    barcodeFoundPrefix: 'I found this product',
    barcodeNotFound:
      'I could not find that barcode in Open Beauty Facts or Open Food Facts. Try a steadier scan, or add ingredients manually.',
    barcodeLookupError: 'I detected a barcode, but the lookup failed. Please try again in a moment.',
    barcodeOcrFallbackIntro:
      'The catalog lookup did not return this product, so I captured your label in a snapshot and I am reading ingredients from that photo next.'
  },
  fr: {
    opener: "Bonjour, je suis Kelly. Je serai votre assistante Skin & Care aujourd'hui. Comment puis-je vous aider ?",
    micReady: "Je vous écoute. Dites-moi ce dont vous avez besoin.",
    attachImage: "Merci, j'ai bien recu votre image. Sur quoi voulez-vous que je me concentre ?",
    attachDoc: "Merci, j'ai bien recu votre fichier. Sur quoi voulez-vous que je me concentre dans ce document ?",
    demoMode: "Cette demo n'est pas connectee a l'API en direct. Configurez REACT_APP_API_BASE vers votre URL middleware (par exemple, http://localhost:4000) pour des reponses en direct.",
    voiceUnsupported: "La saisie vocale n'est pas prise en charge dans ce navigateur. Ouvrez le chat pour taper votre message.",
    genericFallback: 'Je suis la pour vous aider. Comment puis-je vous aider ?',
    networkErrorPrefix: "Desolee, je n'ai pas pu joindre l'assistant pour le moment.",
    barcodeFoundPrefix: "J'ai trouve ce produit",
    barcodeNotFound:
      "Je n'ai pas trouve ce code-barres dans Open Beauty Facts ni Open Food Facts. Reessayez plus stable ou ajoutez la liste d'ingredients.",
    barcodeLookupError: "J'ai detecte un code-barres, mais la recherche a echoue. Veuillez reessayer dans un instant.",
    barcodeOcrFallbackIntro:
      "La base catalogue n'a pas repondu; j'ai capture votre etiquette et je lis les ingredients sur la photo."
  },
  sw: {
    opener: 'Hujambo, mimi ni Kelly. Nitakuwa msaidizi wako wa Skin & Care leo. Naweza kukusaidiaje?',
    micReady: 'Ninakusikiliza. Niambie unachohitaji msaada nacho.',
    attachImage: 'Asante, nimepokea picha yako. Ungependa nizingatie nini?',
    attachDoc: 'Asante, nimepokea faili yako. Ungependa nizingatie nini kwenye hati hii?',
    demoMode: 'Demo hii haijaunganishwa na API ya moja kwa moja. Weka REACT_APP_API_BASE kwenye URL ya middleware yako (mfano, http://localhost:4000) ili kupata majibu ya moja kwa moja.',
    voiceUnsupported: 'Voice input haipatikani kwenye kivinjari hiki. Fungua chat kuandika ujumbe.',
    genericFallback: 'Nipo hapa kukusaidia. Naweza kusaidiaje?',
    networkErrorPrefix: 'Samahani, sikuweza kufikia msaidizi kwa sasa.',
    barcodeFoundPrefix: 'Nimepata bidhaa hii',
    barcodeNotFound:
      'Sikuipata barcode hiyo kwenye Open Beauty Facts wala Open Food Facts. Jaribu tena au ongeza orodha ya viungo.',
    barcodeLookupError: 'Nimegundua barcode, lakini utafutaji umeshindikana. Tafadhali jaribu tena baada ya muda mfupi.'
  },
  ru: {
    opener: 'Здравствуйте, я Келли. Сегодня я ваш ассистент Skin & Care. Чем я могу помочь?',
    micReady: 'Я слушаю вас. Расскажите, чем вам помочь.',
    attachImage: 'Спасибо, я получила ваше изображение. На чем мне сосредоточиться?',
    attachDoc: 'Спасибо, я получила ваш файл. На чем мне сосредоточиться в этом документе?',
    demoMode: 'Демо не подключено к live API. Укажите REACT_APP_API_BASE на URL middleware (например, http://localhost:4000), чтобы получить живые ответы.',
    voiceUnsupported: 'Голосовой ввод не поддерживается в этом браузере. Откройте чат и напишите сообщение.',
    genericFallback: 'Я рядом и готова помочь. Чем могу помочь?',
    networkErrorPrefix: 'Извините, сейчас не удалось подключиться к ассистенту.',
    barcodeFoundPrefix: 'Я нашла этот продукт',
    barcodeNotFound:
      'Не нашла этот штрихкод ни в Open Beauty Facts, ни в Open Food Facts. Попробуйте еще раз или введите состав вручную.',
    barcodeLookupError: 'Я обнаружила штрихкод, но поиск не удался. Пожалуйста, попробуйте еще раз через минуту.',
    barcodeOcrFallbackIntro:
      'Каталог не ответил — я сохранила кадр с этикетки и читаю состав с фото.'
  }
};

const MIN_BARCODE_OCR_FALLBACK_CHARS = 28;

async function tryBarcodeLabelOcrFallback({ labelFrameFile, labelVideo, submitManualIngredients, pushAssistant, copy }) {
  if ((!labelFrameFile && !labelVideo) || typeof submitManualIngredients !== 'function') {
    return { recovered: false };
  }
  let text;
  try {
    const { extractBestLabelTextFromVideoOrFile } = await import('./ingredientOcr');
    text = await extractBestLabelTextFromVideoOrFile({
      video: labelVideo || null,
      file: labelFrameFile || null
    });
  } catch {
    return { recovered: false };
  }
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < MIN_BARCODE_OCR_FALLBACK_CHARS) return { recovered: false };
  pushAssistant(copy.barcodeOcrFallbackIntro, { speak: true });
  const out = await submitManualIngredients(t);
  return { recovered: !!out?.success, ocrText: t };
}

const REGION_HINTS = [
  ['forehead', /\bforehead|brow\b/i],
  ['cheek_left', /\bleft\s+cheek|left side of (your )?face\b/i],
  ['cheek_right', /\bright\s+cheek|right side of (your )?face\b/i],
  ['chin', /\bchin|jaw|jawline\b/i],
  ['neck', /\bneck\b/i],
  ['arm', /\barm|arms\b/i],
  ['leg', /\bleg|legs\b/i],
  ['scalp', /\bscalp\b/i],
  ['trunk', /\bchest|torso|trunk|abdomen\b/i]
];

const VISION_ACTION_RE = /\b(show|camera|frame|capture|hold still|tilt|reposition|point|focus)\b/i;
const VISION_REGION_RE = /\b(forehead|brow|left cheek|right cheek|cheek|chin|jaw|jawline|neck|arm|leg|scalp|chest|torso|trunk|abdomen)\b/i;
const VISION_EXPLICIT_CAPTURE_RE = /\b(show|capture|focus|point)\s+(your|the)?\s*(forehead|brow|left cheek|right cheek|cheek|chin|jaw|jawline|neck|arm|leg|scalp|chest|torso|trunk|abdomen|skin|area)\b/i;
const SW_HINT_RE = /\b(habari|karibu|asante|tafadhali|naomba|nina|sina|wiki|leo|jana|usoni|ngozi)\b/i;
const FR_HINT_RE = /\b(bonjour|merci|s'il|demangeaisons|depuis|semaines|peau|visage|pouvez|aider)\b/i;
const RU_HINT_RE = /[\u0400-\u04FF]/;
const QUICK_HOLD_BY_LANG = {
  en: 'One moment while I check that.',
  fr: 'Un instant, je verifie cela.',
  sw: 'Subiri kidogo nikague hilo.',
  ru: 'Секунду, я проверяю это.'
};

const ENTITY_PATTERNS = [
  ['primary_concern', /\b(redness|rosacea|acne|breakout|eczema|dermatitis|dry|oily|sensitive|pigmentation|dark spots|wrinkle)\b/i],
  ['ingredient', /\b(retinol|retinoid|tretinoin|azelaic acid|niacinamide|salicylic|aha|bha|vitamin c|ceramide|sunscreen|spf)\b/i],
  ['product_intent', /\b(scan|barcode|ingredient list|product|cleanser|moisturizer|serum)\b/i],
  ['body_area', /\b(forehead|cheek|chin|jaw|neck|under eye|scalp)\b/i]
];

function extractEntityEvents(text) {
  const input = String(text || '');
  if (!input.trim()) return [];
  const out = [];
  for (const [type, re] of ENTITY_PATTERNS) {
    const m = input.match(re);
    if (m && m[0]) {
      out.push({
        id: `ee_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        value: String(m[0]).toLowerCase(),
        ts: Date.now()
      });
    }
  }
  return out;
}

function splitVoiceReply(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return { first: '', rest: '' };
  const m = t.match(/^(.+?[.!?])(\s+.+)?$/);
  if (!m) return { first: t, rest: '' };
  const first = String(m[1] || '').trim();
  const rest = String(m[2] || '').trim();
  return { first: first || t, rest };
}
function inferRegionFromAssistantText(text) {
  const s = String(text || '');
  for (const [region, re] of REGION_HINTS) {
    if (re.test(s)) return region;
  }
  return 'other';
}

function looksLikeVisionAsk(text) {
  const s = String(text || '');
  const hasAction = VISION_ACTION_RE.test(s);
  const hasRegion = VISION_REGION_RE.test(s);
  return hasAction && hasRegion;
}

function visionIntentConfidence(text) {
  const s = String(text || '');
  let score = 0;
  if (VISION_ACTION_RE.test(s)) score += 1;
  if (VISION_REGION_RE.test(s)) score += 1;
  if (VISION_EXPLICIT_CAPTURE_RE.test(s)) score += 1;
  return score;
}

function looksLikeVisionRetry(text) {
  return /\b(tilt|move|closer|farther|clearer|lighting|blurry|again|retry|another shot|hold still)\b/i.test(String(text || ''));
}

function extractBarcodeCandidate(text) {
  const m = String(text || '').match(/\b\d{8,14}\b/);
  return m ? m[0] : '';
}

function normalizeBarcodeInput(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

/**
 * Shared assistant state for voice page + chat page (same session_id and message list).
 */
export function useAssistantSession() {
  const apiBase = useMemo(() => resolveMiddlewareApiBase(), []);
  const defaultClinicId = useMemo(() => (process.env.REACT_APP_DEFAULT_CLINIC_ID || '').trim() || null, []);

  const [messages, setMessages] = useState(() => {
    const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
    const lang = String(nav).trim().toLowerCase().split('-')[0] || 'en';
    const copy = TRY_NOW_COPY[lang] || TRY_NOW_COPY.en;
    if (!ASSISTANT_FIRST_ENABLED) return [];
    return [{ id: 'm0', role: 'assistant', text: copy.opener }];
  });
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [interimCaption, setInterimCaption] = useState('');
  const [sending, setSending] = useState(false);
  const [resultSnapshot, setResultSnapshot] = useState(null);
  const [productTrackingActive, setProductTrackingActive] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [pendingScanDecision, setPendingScanDecision] = useState(null);
  const [entityEvents, setEntityEvents] = useState([]);
  const [preferredLanguage, setPreferredLanguage] = useState(() => {
    const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
    return String(nav).trim().toLowerCase().split('-')[0] || 'en';
  });
  const copyForLang = useCallback((langCode) => {
    const code = String(langCode || 'en').trim().toLowerCase().split('-')[0];
    return TRY_NOW_COPY[code] || TRY_NOW_COPY.en;
  }, []);
  const detectLanguageFromText = useCallback((text) => {
    const t = String(text || '').toLowerCase();
    if (RU_HINT_RE.test(t)) return 'ru';
    if (FR_HINT_RE.test(t) || /[àâçéèêëîïôûùüÿœ]/i.test(t)) return 'fr';
    if (SW_HINT_RE.test(t)) return 'sw';
    return preferredLanguage || 'en';
  }, [preferredLanguage]);
  const voiceConfig = useMemo(() => resolveTryNowVoiceConfig(preferredLanguage), [preferredLanguage]);
  const speechLang = voiceConfig.sttLang;
  /** Typed chat: speak Kelly replies via TTS unless REACT_APP_ASSISTANT_CHAT_TTS is 0/false (build-time). */
  const chatReplyTtsEnabled = useMemo(() => {
    const v = String(process.env.REACT_APP_ASSISTANT_CHAT_TTS || '').trim().toLowerCase();
    return v !== '0' && v !== 'false';
  }, []);

  const sessionIdRef = useRef(null);
  const abortRef = useRef(null);
  const voiceKickoffAbortRef = useRef(null);
  const voiceControllerRef = useRef(null);
  const voiceKickoffSpokenRef = useRef(false);
  /** User turned the mic on — keep listening across utterances until they turn it off. */
  const voiceSessionActiveRef = useRef(false);
  /** After final speech, we stop recognition until the assistant reply finishes (reduces TTS echo). */
  const voiceResumeAfterSendRef = useRef(false);
  /** True while waiting for API/TTS so `onend` does not immediately restart recognition. */
  const voicePauseForSendRef = useRef(false);
  const lastVisionRegionRef = useRef('other');
  const visionTriggerCooldownRef = useRef(new Map());
  const lastVisionTriggerSigRef = useRef('');
  const latestTurnSeqRef = useRef(0);
  const scannedBarcodeCooldownRef = useRef(new Map());
  const lastBarcodeLookupFailureSpeechRef = useRef(0);
  const lastPinnedBarcodeRef = useRef('');
  const turnLanguageLockRef = useRef('en');
  const submitManualIngredientsRef = useRef(null);

  const incrementScanMetric = useCallback((metricName) => {
    if (!apiBase || !metricName) return;
    const sid = sessionIdRef.current || getOrCreateLandingSessionId();
    sessionIdRef.current = sid;
    void incrementLandingVoiceMetric({
      apiBase,
      sessionId: sid,
      metricName
    }).catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    sessionIdRef.current = getOrCreateLandingSessionId();
  }, []);

  const pushAssistant = useCallback((text, { speak = true } = {}) => {
    const openingLine = copyForLang(preferredLanguage).opener;
    setMessages((prev) => [...prev, { id: `m${Date.now()}_${Math.random()}`, role: 'assistant', text }]);
    if (speak && text !== openingLine) {
      void speakAssistantReply(text, { apiBase, lang: speechLang });
    }
  }, [apiBase, copyForLang, preferredLanguage, speechLang]);

  const pushEntityEvents = useCallback((events) => {
    const list = Array.isArray(events) ? events.filter(Boolean) : [];
    if (!list.length) return;
    setEntityEvents((prev) => [...list, ...prev].slice(0, 12));
  }, []);

  const publishAssistantVisionTrigger = useCallback(async (replyText) => {
    if (!apiBase) return;
    if (!looksLikeVisionAsk(replyText)) return;
    if (visionIntentConfidence(replyText) < 2) return;
    const sid = sessionIdRef.current || getOrCreateLandingSessionId();
    const inferred = inferRegionFromAssistantText(replyText) || lastVisionRegionRef.current || 'other';
    if (inferred === 'other') return; // Avoid interrupting conversation on ambiguous capture asks.
    const isRetry = looksLikeVisionRetry(replyText);
    const sig = `${sid}:${inferred}:${isRetry ? 'retry' : 'initial'}:${String(replyText || '').slice(0, 80).toLowerCase()}`;
    if (sig === lastVisionTriggerSigRef.current) return;
    lastVisionTriggerSigRef.current = sig;
    const now = Date.now();
    const lastMs = visionTriggerCooldownRef.current.get(inferred) || 0;
    if (now - lastMs < 60000) return;
    visionTriggerCooldownRef.current.set(inferred, now);
    lastVisionRegionRef.current = inferred;
    try {
      await publishVisionCaptureEvent({
        apiBase,
        eventType: 'vision_capture_requested',
        actor: 'assistant',
        idempotencyKey: `assist:${sid}:${isRetry ? 'retry' : 'initial'}:${inferred}:${String(replyText || '').slice(0, 40)}`,
        payload: {
          session_id: sid,
          requested_region: inferred,
          reason: isRetry ? 'retry' : 'initial',
          attempt_index: isRetry ? 2 : 1
        }
      });
    } catch (_) {}
  }, [apiBase]);

  const abortVoiceKickoff = useCallback(() => {
    if (!voiceKickoffAbortRef.current) return;
    try {
      voiceKickoffAbortRef.current.abort();
    } catch (_) {}
    voiceKickoffAbortRef.current = null;
  }, []);

  /** Ask the agent to open the voice turn (assistant speaks first). Does not add a user bubble. */
  const requestVoiceKickoff = useCallback(async () => {
    abortVoiceKickoff();
    const copy = copyForLang(preferredLanguage);
    const text = voiceKickoffSpokenRef.current ? copy.micReady : copy.opener;
    voiceKickoffSpokenRef.current = true;
    pushAssistant(text);
  }, [abortVoiceKickoff, copyForLang, preferredLanguage, pushAssistant]);

  const refreshResultSnapshot = useCallback(async () => {
    if (!apiBase) return null;
    const sid = sessionIdRef.current || getOrCreateLandingSessionId();
    sessionIdRef.current = sid;
    try {
      const data = await fetchLandingResultSnapshot({ apiBase, sessionId: sid });
      const snap = data?.session_result_snapshot || null;
      if (snap) setResultSnapshot(snap);
      return snap;
    } catch (_) {
      return null;
    }
  }, [apiBase]);

  const submitResultEdit = useCallback(async ({ fieldPath, userValue, reasonForChange, confidenceAfter = null }) => {
    if (!apiBase) return null;
    const sid = sessionIdRef.current || getOrCreateLandingSessionId();
    sessionIdRef.current = sid;
    const data = await submitLandingResultEdit({
      apiBase,
      sessionId: sid,
      fieldPath,
      userValue,
      reasonForChange,
      confidenceAfter
    });
    const snap = data?.session_result_snapshot || null;
    if (snap) setResultSnapshot(snap);
    return snap;
  }, [apiBase]);

  const sendUserMessage = useCallback(
    async (text, { sttFinalAt = null } = {}) => {
      abortVoiceKickoff();

      const shouldResumeVoiceListening = voiceResumeAfterSendRef.current;
      voiceResumeAfterSendRef.current = false;

      const resumeVoiceListeningIfNeeded = async () => {
        if (!shouldResumeVoiceListening || !voiceSessionActiveRef.current) return;
        voicePauseForSendRef.current = false;
        if (voiceControllerRef.current) {
          await voiceControllerRef.current.resumeAfterAssistant();
        }
      };

      const t = String(text || '').trim();
      pushEntityEvents(extractEntityEvents(t));
      const inferredLanguage = detectLanguageFromText(t);
      const turnLanguage = String(inferredLanguage || preferredLanguage || 'en')
        .trim()
        .toLowerCase()
        .split('-')[0] || 'en';
      turnLanguageLockRef.current = turnLanguage;
      if (inferredLanguage && inferredLanguage !== preferredLanguage) {
        setPreferredLanguage(inferredLanguage);
      }

      const names = attachments.map((a) => a.name).filter(Boolean);
      if (!t && names.length === 0) return;
      const barcode = extractBarcodeCandidate(t);
      if (isProductTrackingIntent(t)) {
        setProductTrackingActive(true);
      }

      const display =
        t + (names.length ? `${t ? '\n\n' : ''}[Attached: ${names.join(', ')}]` : '');

      setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', text: display }]);
      setInput('');
      setAttachments([]);

      if (names.length && !t) {
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        sessionIdRef.current = sid;
        await Promise.allSettled(
          names.slice(0, 6).map((name) =>
            publishLandingThreadEvent({
              apiBase,
              sessionId: sid,
              eventType: 'attachment',
              text: `[Attachment] ${name}`,
              fileName: name
            })
          )
        );
        const hasDocument = names.some((name) => /\.(pdf|doc|docx|txt|rtf)$/i.test(String(name || '')));
        const attachmentFollowup = hasDocument
          ? copyForLang(turnLanguage).attachDoc
          : copyForLang(turnLanguage).attachImage;
        window.setTimeout(() => {
          pushAssistant(attachmentFollowup);
          void resumeVoiceListeningIfNeeded();
        }, 400);
        return null;
      }

      if (!apiBase) {
        const copy = copyForLang(turnLanguage);
        window.setTimeout(() => {
          if (names.length) {
            const hasDocument = names.some((name) => /\.(pdf|doc|docx|txt|rtf)$/i.test(String(name || '')));
            pushAssistant(hasDocument ? copy.attachDoc : copy.attachImage);
          } else {
            pushAssistant(copy.demoMode);
          }
          void resumeVoiceListeningIfNeeded();
        }, 400);
        return null;
      }
      /** Snapshot for this turn’s LLM request (React state may lag behind in-message barcode lookup). */
      let scanForTurn = scanResult;
      let pinReadyForTurn = !!(
        scanResult?.product &&
        scanResult?.barcode &&
        lastPinnedBarcodeRef.current === scanResult.barcode
      );

      if (scanResult?.product && scanResult?.barcode && lastPinnedBarcodeRef.current !== scanResult.barcode) {
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        sessionIdRef.current = sid;
        const pinText = buildPinnedContextText(scanResult);
        await publishLandingThreadEvent({
          apiBase,
          sessionId: sid,
          eventType: 'scan_context_pinned',
          text: pinText
        }).catch(() => {});
        lastPinnedBarcodeRef.current = scanResult.barcode;
      }

      if (barcode) {
        const cleanVoice = normalizeBarcodeInput(barcode);
        try {
          const { facts, resolvedCatalog } = await fetchBarcodeFactsAutodetect({ apiBase, barcode: cleanVoice });
          const p = facts?.product || {};
          const quality = buildScanQuality(p);
          const { route: resolvedRoute, usedFallback: routeFallback } = resolveServerCategoryRoute(
            facts?.category_route
          );
          const categoryRoute = routeFallback ? deriveCategoryRoute(p.categories_tags) : resolvedRoute;
          if (routeFallback) {
            incrementScanMetric('scan.category_route.client_fallback_used');
          }
          const nextScan = {
            barcode: p.barcode || cleanVoice,
            product: p,
            quality,
            dataSource: facts?.data_source || 'unknown',
            resolvedCatalog,
            recoveryRequired: !quality.analyzeEnabled,
            categoryRoute,
            categoryRouteSource: routeFallback ? 'legacy_client_derive' : (facts?.category_route_source || 'server'),
            categoryRouteConfidence: routeFallback ? null : (facts?.category_route_confidence || null),
            categoryRouteRuleId: routeFallback ? null : (facts?.category_route_rule_id || null),
            categoryRouteFallback: routeFallback ? null : (facts?.category_route_fallback || null),
            scanSummary: facts?.scan_summary || null,
            ingredientFlags: deriveIngredientFlags(p),
            sparseData: isSparseProductData(p)
          };
          if (categoryRoute === 'unknown') {
            incrementScanMetric('scan.lookup_found_route_unknown.count');
          } else {
            incrementScanMetric('scan.lookup_found_route_known.count');
          }
          setScanResult(nextScan);
          scanForTurn = nextScan;
          pinReadyForTurn = !!(nextScan.product && nextScan.barcode);
          if (nextScan.barcode) lastPinnedBarcodeRef.current = String(nextScan.barcode);
          const imgUrlChat = String(pickFirstProductImageUrl(p) || '').trim();
          const productLine = `[Barcode Scan] ${p.product_name || 'Product found'} (${p.barcode || cleanVoice})`;
          const imageLine = imgUrlChat ? `Product image: ${imgUrlChat}` : '';
          const ingredientLine = p.ingredients_text ? `Ingredients: ${String(p.ingredients_text).slice(0, 900)}` : '';
          const labelsLine = Array.isArray(p.labels) && p.labels.length ? `Labels: ${p.labels.slice(0, 12).join(', ')}` : '';
          const allergensLine =
            Array.isArray(p.allergens) && p.allergens.length ? `Allergens: ${p.allergens.slice(0, 12).join(', ')}` : '';
          const payloadText = [productLine, imageLine, ingredientLine, labelsLine, allergensLine].filter(Boolean).join('\n');
          const sid = sessionIdRef.current || getOrCreateLandingSessionId();
          sessionIdRef.current = sid;
          await publishLandingThreadEvent({
            apiBase,
            sessionId: sid,
            eventType: 'barcode_product_context',
            text: payloadText,
            productData: serializeObfProductForThread(p, facts?.data_source || null, {
              categoryRoute: nextScan.categoryRoute,
              categoryRouteSource: nextScan.categoryRouteSource,
              categoryRouteConfidence: nextScan.categoryRouteConfidence,
              categoryRouteRuleId: nextScan.categoryRouteRuleId,
              categoryRouteFallback: nextScan.categoryRouteFallback,
              scanSummary: facts?.scan_summary || null
            })
          });
          await refreshResultSnapshot();
          const copy = copyForLang(inferredLanguage || preferredLanguage);
          pushAssistant(`${copy.micReady} I found this product and added its ingredient profile to context.`, {
            speak: false
          });
        } catch (e) {
          const errCode = String(e?.body?.error || e?.message || '');
          if (String(errCode).includes('upstream_404')) {
            incrementScanMetric('scan.lookup_not_found.count');
            const sid = sessionIdRef.current || getOrCreateLandingSessionId();
            sessionIdRef.current = sid;
            await publishLandingThreadEvent({
              apiBase,
              sessionId: sid,
              eventType: 'barcode_product_context',
              text: `[Barcode Scan] No match in Open Beauty Facts or Open Food Facts for barcode (${cleanVoice})`,
              productData: serializeBarcodeNotFoundForThread(cleanVoice, 'live_api', 'both')
            }).catch(() => {});
            await refreshResultSnapshot().catch(() => {});
            pushAssistant(copyForLang(turnLanguage).barcodeNotFound, { speak: false });
          }
        }
      }

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (_) {}
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setSending(true);
      const holdTimer = window.setTimeout(async () => {
        if (!voiceSessionActiveRef.current || !ac || ac.signal.aborted) return;
        const holdText = QUICK_HOLD_BY_LANG[turnLanguage] || QUICK_HOLD_BY_LANG.en;
        pushAssistant(holdText, { speak: false });
        try {
          await speakAssistantReply(holdText, {
            apiBase,
            lang: resolveTryNowVoiceConfig(turnLanguage).sttLang
          });
        } catch (_) {}
      }, 1800);
      try {
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        sessionIdRef.current = sid;
        const turnSeq = ++latestTurnSeqRef.current;
        const voiceTimelinePoints = {
          stt_final_at: Number(sttFinalAt) || null,
          turn_request_sent_at: Date.now()
        };
        const turnMessage = buildFollowupMessageWithPinnedContext(t, scanForTurn, pinReadyForTurn);
        const data = await sendLandingAssistantTurn({
          apiBase,
          message: turnMessage,
          sessionId: sid,
          turnSeq,
          clinicId: defaultClinicId,
          preferredLanguage: turnLanguage,
          signal: ac.signal
        });
        voiceTimelinePoints.turn_reply_received_at = Date.now();
        if (data.session_id) {
          sessionIdRef.current = data.session_id;
          try {
            sessionStorage.setItem('littlelab_landing_assistant_sid', data.session_id);
          } catch (_) {}
        }
        const serverLang = String(data.preferred_language || data.language || '').trim().toLowerCase();
        if (serverLang && serverLang !== preferredLanguage) {
          setPreferredLanguage(serverLang.split('-')[0]);
        }
        const reply = (data.reply && String(data.reply).trim()) || copyForLang(turnLanguage).genericFallback;
        pushEntityEvents(extractEntityEvents(reply));
        if (data?.session_result_snapshot) {
          setResultSnapshot(data.session_result_snapshot);
        } else if (data?.next_step === 'skincare_report') {
          await refreshResultSnapshot();
        }
        const rawReplySeq = data.reply_seq;
        const replySeq = Number(rawReplySeq);
        // If middleware omits reply_seq, do not suppress TTS (older proxies or skipped payloads).
        const isLatestReply =
          rawReplySeq == null || rawReplySeq === ''
            ? true
            : replySeq === latestTurnSeqRef.current;
        const ttsMeta = { ttsVoice: '', ttsModel: '', ttsLang: '' };
        pushAssistant(reply, { speak: false });
        const shouldPlayTts =
          isLatestReply && (voiceSessionActiveRef.current || chatReplyTtsEnabled);
        if (shouldPlayTts) {
          const voiceCfg = resolveTryNowVoiceConfig(turnLanguage);
          const onTtsMeta = (meta) => {
            if (!meta || typeof meta !== 'object') return;
            ttsMeta.ttsVoice = String(meta.ttsVoice || '').trim();
            ttsMeta.ttsModel = String(meta.ttsModel || '').trim();
            ttsMeta.ttsLang = String(meta.ttsLang || '').trim().toLowerCase();
          };
          const onFirstByte = () => {
            if (!voiceTimelinePoints.tts_first_byte_at) voiceTimelinePoints.tts_first_byte_at = Date.now();
          };
          const onPlaybackReady = () => {
            if (!voiceTimelinePoints.tts_download_done_at) voiceTimelinePoints.tts_download_done_at = Date.now();
          };
          const onAudioStart = () => {
            if (!voiceTimelinePoints.audio_play_start_at) voiceTimelinePoints.audio_play_start_at = Date.now();
          };
          voiceTimelinePoints.tts_request_sent_at = Date.now();
          if (voiceSessionActiveRef.current) {
            const { first, rest } = splitVoiceReply(reply);
            const firstText = first || reply;
            await speakAssistantReply(firstText, {
              apiBase,
              lang: voiceCfg.sttLang,
              onTtsMeta,
              onFirstByte,
              onPlaybackReady,
              onAudioStart
            });
            if (rest && voiceSessionActiveRef.current && isLatestReply) {
              await speakAssistantReply(rest, {
                apiBase,
                lang: voiceCfg.sttLang
              });
            }
          } else {
            await speakAssistantReply(reply, {
              apiBase,
              lang: voiceCfg.sttLang,
              onTtsMeta,
              onFirstByte,
              onPlaybackReady,
              onAudioStart
            });
          }
        }
        if (voiceSessionActiveRef.current && voiceControllerRef.current) {
          voiceControllerRef.current.pauseForAssistant();
          await waitForAssistantSpeechToFinish({ timeoutMs: 10000 });
        }
        void publishLandingVoiceTimeline({
          apiBase,
          sessionId: sid,
          turnSeq,
          lang: turnLanguage,
          detectedLanguage: inferredLanguage || '',
          preferredLanguage: String(preferredLanguage || '').toLowerCase(),
          ttsVoice: ttsMeta.ttsVoice,
          ttsModel: ttsMeta.ttsModel,
          ttsLang: ttsMeta.ttsLang || turnLanguage,
          points: voiceTimelinePoints
        }).catch(() => {});
        void publishAssistantVisionTrigger(reply);
        return data;
      } catch (e) {
        if (e.name === 'AbortError') return;
        const msg =
          e.message ||
          'I am having trouble connecting right now. Please try again in a moment.';
        const copy = copyForLang(preferredLanguage);
        pushAssistant(`${copy.networkErrorPrefix} ${msg}`, { speak: false });
        return null;
      } finally {
        window.clearTimeout(holdTimer);
        setSending(false);
        abortRef.current = null;
        await resumeVoiceListeningIfNeeded();
      }
    },
    [
      abortVoiceKickoff,
      apiBase,
      attachments,
      chatReplyTtsEnabled,
      copyForLang,
      defaultClinicId,
      detectLanguageFromText,
      preferredLanguage,
      pushAssistant,
      publishAssistantVisionTrigger,
      pushEntityEvents,
      refreshResultSnapshot,
      scanResult
    ]
  );

  const ingestScannedBarcode = useCallback(
    async (barcode, opts = {}) => {
      const labelFrameFile = opts.labelFrameFile || null;
      const labelVideo = opts.labelVideo || null;
      const clean = normalizeBarcodeInput(barcode);
      if (!/^\d{8,14}$/.test(clean)) return { success: false, reason: 'invalid_barcode' };
      const now = Date.now();
      const prevMs = scannedBarcodeCooldownRef.current.get(clean) || 0;
      if (now - prevMs < 90000) return { success: false, reason: 'cooldown' };
      scannedBarcodeCooldownRef.current.set(clean, now);
      const lang = preferredLanguage || 'en';
      const copy = copyForLang(lang);
      if (!apiBase) return { success: false, reason: 'no_api' };

      const applyOcrLabelScan = (ocrText) => {
        const product = {
          product_name: 'From label snapshot',
          ingredients_text: ocrText.slice(0, 2000),
          barcode: clean,
          source: 'ocr_label_photo'
        };
        setScanResult({
          barcode: clean,
          product,
          dataSource: 'ocr_label_photo',
          resolvedCatalog: null,
          quality: buildScanQuality(product),
          recoveryRequired: false,
          categoryRoute: deriveCategoryRoute(product.categories_tags || []),
          categoryRouteSource: 'legacy_client_derive',
          categoryRouteConfidence: null,
          categoryRouteRuleId: null,
          categoryRouteFallback: null,
          scanSummary: null,
          ingredientFlags: deriveIngredientFlags(product),
          sparseData: isSparseProductData(product)
        });
      };

      try {
        const { facts, resolvedCatalog } = await fetchBarcodeFactsAutodetect({ apiBase, barcode: clean });
        const p = facts?.product || {};
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        sessionIdRef.current = sid;
        const productName = p.product_name || `barcode ${clean}`;
        const quality = buildScanQuality(p);
        const { route: resolvedRoute, usedFallback: routeFallback } = resolveServerCategoryRoute(
          facts?.category_route
        );
        const categoryRoute = routeFallback ? deriveCategoryRoute(p.categories_tags) : resolvedRoute;
        if (routeFallback) {
          incrementScanMetric('scan.category_route.client_fallback_used');
        }
        const nextScan = {
          barcode: p.barcode || clean,
          product: p,
          resolvedCatalog,
          quality,
          dataSource: facts?.data_source || 'unknown',
          recoveryRequired: !quality.analyzeEnabled,
          // Prefer server-resolved category contract to avoid client/server drift.
          categoryRoute,
          categoryRouteSource: routeFallback ? 'legacy_client_derive' : (facts?.category_route_source || 'server'),
          categoryRouteConfidence: routeFallback ? null : (facts?.category_route_confidence || null),
          categoryRouteRuleId: routeFallback ? null : (facts?.category_route_rule_id || null),
          categoryRouteFallback: routeFallback ? null : (facts?.category_route_fallback || null),
          scanSummary: facts?.scan_summary || null,
          ingredientFlags: deriveIngredientFlags(p),
          sparseData: isSparseProductData(p)
        };
        if (categoryRoute === 'unknown') {
          incrementScanMetric('scan.lookup_found_route_unknown.count');
        } else {
          incrementScanMetric('scan.lookup_found_route_known.count');
        }
        if (scanResult?.product && scanResult?.barcode && scanResult.barcode !== nextScan.barcode) {
          setPendingScanDecision({ previous: scanResult, next: nextScan });
          return { success: true, barcode: clean, productName, quality, pendingDecision: true };
        }
        setScanResult(nextScan);
        const imgUrl = String(pickFirstProductImageUrl(p) || '').trim();
        const contextText = [
          `[Barcode Scan] ${productName} (${p.barcode || clean})`,
          imgUrl ? `Product image: ${imgUrl}` : '',
          p.ingredients_text ? `Ingredients: ${String(p.ingredients_text).slice(0, 900)}` : '',
          Array.isArray(p.labels) && p.labels.length ? `Labels: ${p.labels.slice(0, 12).join(', ')}` : '',
          Array.isArray(p.allergens) && p.allergens.length ? `Allergens: ${p.allergens.slice(0, 12).join(', ')}` : '',
          `Category Route: ${nextScan.categoryRoute}`,
          nextScan.categoryRouteSource ? `Category Route Source: ${nextScan.categoryRouteSource}` : '',
          nextScan.categoryRouteConfidence ? `Category Route Confidence: ${nextScan.categoryRouteConfidence}` : '',
          `Sparse Data: ${nextScan.sparseData ? 'yes' : 'no'}`,
          `Provenance: ${nextScan.dataSource}`
        ]
          .filter(Boolean)
          .join('\n');
        await publishLandingThreadEvent({
          apiBase,
          sessionId: sid,
          eventType: 'barcode_product_context',
          text: contextText,
          productData: serializeObfProductForThread(p, nextScan.dataSource, {
            categoryRoute: nextScan.categoryRoute,
            categoryRouteSource: nextScan.categoryRouteSource,
            categoryRouteConfidence: nextScan.categoryRouteConfidence,
            categoryRouteRuleId: nextScan.categoryRouteRuleId,
            categoryRouteFallback: nextScan.categoryRouteFallback,
            scanSummary: facts?.scan_summary || null
          })
        });
        await refreshResultSnapshot();
        pushAssistant(`${copy.barcodeFoundPrefix}: ${productName}. I added its ingredient profile to your session context.`, {
          speak: true
        });
        pushEntityEvents([{
          id: `ee_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'product_match',
          value: productName,
          ts: Date.now()
        }]);
        return { success: true, barcode: clean, productName, quality };
      } catch (e) {
        const errCode = String(e?.body?.error || e?.message || '');
        const sub = submitManualIngredientsRef.current;

        if (String(errCode).includes('upstream_404')) {
          incrementScanMetric('scan.lookup_not_found.count');
          if ((labelFrameFile || labelVideo) && typeof sub === 'function') {
            const ocrTry = await tryBarcodeLabelOcrFallback({
              labelFrameFile,
              labelVideo,
              submitManualIngredients: sub,
              pushAssistant,
              copy
            });
            if (ocrTry.recovered && ocrTry.ocrText) {
              applyOcrLabelScan(ocrTry.ocrText);
              await refreshResultSnapshot().catch(() => {});
              return { success: true, barcode: clean, productName: 'From label snapshot', reason: 'ocr_fallback' };
            }
          }
          const sid = sessionIdRef.current || getOrCreateLandingSessionId();
          sessionIdRef.current = sid;
          setScanResult({
            barcode: clean,
            product: null,
            quality: {
              tier: 'insufficient',
              analyzeEnabled: false,
              analyzeLabel: 'Add ingredients to analyze',
              summary: 'Product not found',
              missing: ['product']
            },
            dataSource: 'live_api',
            recoveryRequired: true
          });
          const notFoundText = `[Barcode Scan] No match in Open Beauty Facts or Open Food Facts for barcode (${clean})`;
          await publishLandingThreadEvent({
            apiBase,
            sessionId: sid,
            eventType: 'barcode_product_context',
            text: notFoundText,
            productData: serializeBarcodeNotFoundForThread(clean, 'live_api', 'both')
          });
          await refreshResultSnapshot();
          pushAssistant(copy.barcodeNotFound, { speak: true });
          return { success: false, reason: 'not_found' };
        }
        if (String(errCode).includes('invalid_barcode')) {
          return { success: false, reason: 'invalid_barcode' };
        }

        if ((labelFrameFile || labelVideo) && typeof sub === 'function') {
          const ocrTry = await tryBarcodeLabelOcrFallback({
            labelFrameFile,
            labelVideo,
            submitManualIngredients: sub,
            pushAssistant,
            copy
          });
          if (ocrTry.recovered && ocrTry.ocrText) {
            applyOcrLabelScan(ocrTry.ocrText);
            await refreshResultSnapshot().catch(() => {});
            return { success: true, barcode: clean, productName: 'From label snapshot', reason: 'ocr_fallback' };
          }
        }

        const t = Date.now();
        const speakErr = t - lastBarcodeLookupFailureSpeechRef.current > 55000;
        if (speakErr) lastBarcodeLookupFailureSpeechRef.current = t;
        pushAssistant(copy.barcodeLookupError, { speak: speakErr });
        return { success: false, reason: 'lookup_failed' };
      }
    },
    [apiBase, copyForLang, incrementScanMetric, preferredLanguage, pushAssistant, pushEntityEvents, refreshResultSnapshot, scanResult]
  );

  const resolvePendingScanDecision = useCallback(async (mode = 'refine') => {
    const pending = pendingScanDecision;
    if (!pending?.next) return { success: false, reason: 'no_pending_scan' };
    if (mode === 'compare' && pending.previous?.product && pending.next?.product) {
      const cmp = compareProducts(pending.previous.product, pending.next.product);
      pushAssistant(
        `Comparison A vs B: overlap ${cmp.overlapCount} ingredients. Only A: ${cmp.onlyA.join(', ') || 'none'}. Only B: ${cmp.onlyB.join(', ') || 'none'}.`,
        { speak: false }
      );
    }
    if (mode === 'reset') {
      setMessages((prev) => prev.filter((m) => !String(m.text || '').includes('[Pinned Product Context]')));
    }
    setScanResult(pending.next);
    setPendingScanDecision(null);
    lastPinnedBarcodeRef.current = '';
    return { success: true };
  }, [pendingScanDecision, pushAssistant]);

  const submitManualIngredients = useCallback(async (ingredientsText) => {
    const text = String(ingredientsText || '').trim();
    if (!text) return { success: false, reason: 'empty_ingredients' };
    const sid = sessionIdRef.current || getOrCreateLandingSessionId();
    sessionIdRef.current = sid;
    if (!apiBase) return { success: false, reason: 'no_api' };
    const bundle = `[Manual Ingredients]\n${text.slice(0, 2000)}`;
    await publishLandingThreadEvent({
      apiBase,
      sessionId: sid,
      eventType: 'manual_ingredients_context',
      text: bundle
    });
    setMessages((prev) => [...prev, { id: `u${Date.now()}_${Math.random()}`, role: 'user', text: `Please analyze these ingredients for my skin:\n${text}` }]);
    setSending(true);
    try {
      const turnSeq = ++latestTurnSeqRef.current;
      const data = await sendLandingAssistantTurn({
        apiBase,
        message: `Analyze this ingredient list for my skin profile and explain safety/risk in bullets:\n${text}`,
        sessionId: sid,
        turnSeq,
        clinicId: defaultClinicId,
        preferredLanguage
      });
      const reply = (data.reply && String(data.reply).trim()) || copyForLang(preferredLanguage).genericFallback;
      if (data?.session_result_snapshot) {
        setResultSnapshot(data.session_result_snapshot);
      } else if (data?.next_step === 'skincare_report') {
        await refreshResultSnapshot();
      }
      pushAssistant(prependManualIngredientGuard(reply), { speak: false });
      return { success: true };
    } catch (e) {
      pushAssistant(`${copyForLang(preferredLanguage).networkErrorPrefix} ${e.message || 'Failed to analyze ingredients.'}`, { speak: false });
      return { success: false, reason: 'analysis_failed' };
    } finally {
      setSending(false);
    }
  }, [apiBase, copyForLang, defaultClinicId, preferredLanguage, pushAssistant, refreshResultSnapshot]);

  submitManualIngredientsRef.current = submitManualIngredients;

  /** Sends a landing turn so the middleware can build a real session_result_snapshot (not the UI dummy). */
  const requestScanAnalysis = useCallback(async () => {
    if (!scanResult?.product) {
      pushAssistant('Scan or enter a product barcode first, then tap analyze.', { speak: false });
      return;
    }
    await sendUserMessage(
      'Analyze the scanned product in my session for my skin: summarize fit, ingredient risks, and routine conflicts. Generate my skincare report snapshot.'
    );
  }, [pushAssistant, scanResult, sendUserMessage]);

  useEffect(() => {
    const controller = createWebVoiceTurnController({
      lang: speechLang,
      interruptionMinChars: voiceConfig.interruptionMinChars,
      minFinalChars: voiceConfig.minFinalChars,
      restartDelayMs: voiceConfig.restartDelayMs,
      onInterim: (text) => setInterimCaption(text),
      onFinal: async (said) => {
        setInterimCaption('');
        voiceResumeAfterSendRef.current = voiceSessionActiveRef.current;
        voicePauseForSendRef.current = true;
        if (voiceControllerRef.current) voiceControllerRef.current.pauseForAssistant();
        await sendUserMessage(said, { sttFinalAt: Date.now() });
      },
      onBargeIn: () => {
        stopAssistantSpeech();
        if (abortRef.current) {
          try { abortRef.current.abort(); } catch (_) {}
        }
        latestTurnSeqRef.current += 1;
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        void incrementLandingVoiceMetric({
          apiBase,
          sessionId: sid,
          metricName: 'voice.interruption'
        }).catch(() => {});
        if (voiceControllerRef.current?.isPaused?.()) {
          void voiceControllerRef.current.resumeAfterAssistant({ flush: false });
        }
      },
      onFatalError: () => {
        voiceSessionActiveRef.current = false;
        setVoiceActive(false);
        setInterimCaption('');
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        void incrementLandingVoiceMetric({
          apiBase,
          sessionId: sid,
          metricName: 'voice.stt_fatal'
        }).catch(() => {});
      }
    });
    if (!controller) return undefined;
    voiceControllerRef.current = controller;
    return () => {
      if (voiceControllerRef.current) {
        voiceControllerRef.current.stop();
      }
    };
  }, [apiBase, sendUserMessage, speechLang, voiceConfig.interruptionMinChars, voiceConfig.minFinalChars, voiceConfig.restartDelayMs]);

  const toggleVoice = useCallback(
    (onUnsupported) => {
      const controller = voiceControllerRef.current;
      if (!controller) {
        pushAssistant(copyForLang(preferredLanguage).voiceUnsupported, {
          speak: false
        });
        onUnsupported?.();
        return;
      }
      if (voiceActive) {
        abortVoiceKickoff();
        voiceSessionActiveRef.current = false;
        voicePauseForSendRef.current = false;
        voiceResumeAfterSendRef.current = false;
        controller.stop();
        setVoiceActive(false);
        setInterimCaption('');
        return;
      }
      setInterimCaption('');
      primeAssistantAudioGate();
      stopAssistantSpeech();
      voiceSessionActiveRef.current = true;
      voicePauseForSendRef.current = false;
      latestTurnSeqRef.current = 0;
      setVoiceActive(true);
      controller.start();
      void requestVoiceKickoff();
    },
    [abortVoiceKickoff, copyForLang, preferredLanguage, pushAssistant, requestVoiceKickoff, voiceActive]
  );

  const addFiles = useCallback((fileList) => {
    const next = Array.from(fileList || []).slice(0, 6);
    if (!next.length) return;
    setAttachments((prev) => [...prev, ...next].slice(0, 8));
  }, []);

  return {
    apiBase,
    messages,
    setMessages,
    input,
    setInput,
    attachments,
    setAttachments,
    voiceActive,
    setVoiceActive,
    interimCaption,
    sending,
    resultSnapshot,
    setResultSnapshot,
    productTrackingActive,
    setProductTrackingActive,
    scanResult,
    setScanResult,
    pendingScanDecision,
    resolvePendingScanDecision,
    entityEvents,
    sessionIdRef,
    recognitionRef: voiceControllerRef,
    pushAssistant,
    sendUserMessage,
    toggleVoice,
    addFiles
    ,
    preferredLanguage,
    leadText: copyForLang(preferredLanguage).opener,
    ingestScannedBarcode,
    submitManualIngredients,
    requestScanAnalysis,
    refreshResultSnapshot,
    submitResultEdit
  };
}
