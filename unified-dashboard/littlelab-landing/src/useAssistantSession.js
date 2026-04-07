import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getOrCreateLandingSessionId,
  incrementLandingVoiceMetric,
  publishLandingThreadEvent,
  resolveMiddlewareApiBase,
  sendLandingAssistantTurn
} from './landingAssistantApi';
import { publishVisionCaptureEvent } from './landingLiveKitApi';
import { speakAssistantReply, stopAssistantSpeech, waitForAssistantSpeechToFinish } from './assistantSpeech';
import { createWebVoiceTurnController } from './webVoiceTurnController';
import { resolveTryNowVoiceConfig } from './tryNowVoiceConfig';

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
    networkErrorPrefix: 'Sorry, I could not reach the assistant just now.'
  },
  fr: {
    opener: "Bonjour, je suis Kelly. Je serai votre assistante Skin & Care aujourd'hui. Comment puis-je vous aider ?",
    micReady: "Je vous écoute. Dites-moi ce dont vous avez besoin.",
    attachImage: "Merci, j'ai bien recu votre image. Sur quoi voulez-vous que je me concentre ?",
    attachDoc: "Merci, j'ai bien recu votre fichier. Sur quoi voulez-vous que je me concentre dans ce document ?",
    demoMode: "Cette demo n'est pas connectee a l'API en direct. Configurez REACT_APP_API_BASE vers votre URL middleware (par exemple, http://localhost:4000) pour des reponses en direct.",
    voiceUnsupported: "La saisie vocale n'est pas prise en charge dans ce navigateur. Ouvrez le chat pour taper votre message.",
    genericFallback: 'Je suis la pour vous aider. Comment puis-je vous aider ?',
    networkErrorPrefix: "Desolee, je n'ai pas pu joindre l'assistant pour le moment."
  },
  sw: {
    opener: 'Hujambo, mimi ni Kelly. Nitakuwa msaidizi wako wa Skin & Care leo. Naweza kukusaidiaje?',
    micReady: 'Ninakusikiliza. Niambie unachohitaji msaada nacho.',
    attachImage: 'Asante, nimepokea picha yako. Ungependa nizingatie nini?',
    attachDoc: 'Asante, nimepokea faili yako. Ungependa nizingatie nini kwenye hati hii?',
    demoMode: 'Demo hii haijaunganishwa na API ya moja kwa moja. Weka REACT_APP_API_BASE kwenye URL ya middleware yako (mfano, http://localhost:4000) ili kupata majibu ya moja kwa moja.',
    voiceUnsupported: 'Voice input haipatikani kwenye kivinjari hiki. Fungua chat kuandika ujumbe.',
    genericFallback: 'Nipo hapa kukusaidia. Naweza kusaidiaje?',
    networkErrorPrefix: 'Samahani, sikuweza kufikia msaidizi kwa sasa.'
  },
  ru: {
    opener: 'Здравствуйте, я Келли. Сегодня я ваш ассистент Skin & Care. Чем я могу помочь?',
    micReady: 'Я слушаю вас. Расскажите, чем вам помочь.',
    attachImage: 'Спасибо, я получила ваше изображение. На чем мне сосредоточиться?',
    attachDoc: 'Спасибо, я получила ваш файл. На чем мне сосредоточиться в этом документе?',
    demoMode: 'Демо не подключено к live API. Укажите REACT_APP_API_BASE на URL middleware (например, http://localhost:4000), чтобы получить живые ответы.',
    voiceUnsupported: 'Голосовой ввод не поддерживается в этом браузере. Откройте чат и напишите сообщение.',
    genericFallback: 'Я рядом и готова помочь. Чем могу помочь?',
    networkErrorPrefix: 'Извините, сейчас не удалось подключиться к ассистенту.'
  }
};

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

  const sendUserMessage = useCallback(
    async (text) => {
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
      const inferredLanguage = detectLanguageFromText(t);
      if (inferredLanguage && inferredLanguage !== preferredLanguage) {
        setPreferredLanguage(inferredLanguage);
      }

      const names = attachments.map((a) => a.name).filter(Boolean);
      if (!t && names.length === 0) return;

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
          ? copyForLang(inferredLanguage || preferredLanguage).attachDoc
          : copyForLang(inferredLanguage || preferredLanguage).attachImage;
        window.setTimeout(() => {
          pushAssistant(attachmentFollowup);
          void resumeVoiceListeningIfNeeded();
        }, 400);
        return;
      }

      if (!apiBase) {
        const copy = copyForLang(inferredLanguage || preferredLanguage);
        window.setTimeout(() => {
          if (names.length) {
            const hasDocument = names.some((name) => /\.(pdf|doc|docx|txt|rtf)$/i.test(String(name || '')));
            pushAssistant(hasDocument ? copy.attachDoc : copy.attachImage);
          } else {
            pushAssistant(copy.demoMode);
          }
          void resumeVoiceListeningIfNeeded();
        }, 400);
        return;
      }

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (_) {}
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setSending(true);
      try {
        const sid = sessionIdRef.current || getOrCreateLandingSessionId();
        sessionIdRef.current = sid;
        const turnSeq = ++latestTurnSeqRef.current;
        const data = await sendLandingAssistantTurn({
          apiBase,
          message: t,
          sessionId: sid,
          turnSeq,
          clinicId: defaultClinicId,
          preferredLanguage: inferredLanguage || preferredLanguage || 'en',
          signal: ac.signal
        });
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
        const reply = (data.reply && String(data.reply).trim()) || copyForLang(inferredLanguage || preferredLanguage).genericFallback;
        const replySeq = Number(data.reply_seq || 0);
        const isLatestReply = replySeq === latestTurnSeqRef.current;
        // Keep chat-only turns silent; only speak while an active voice session is on.
        pushAssistant(reply, { speak: false });
        if (voiceSessionActiveRef.current && isLatestReply) {
          await speakAssistantReply(reply, { apiBase, lang: resolveTryNowVoiceConfig(inferredLanguage || preferredLanguage).sttLang });
        }
        if (voiceSessionActiveRef.current && voiceControllerRef.current) {
          voiceControllerRef.current.pauseForAssistant();
          await waitForAssistantSpeechToFinish({ timeoutMs: 10000 });
        }
        void publishAssistantVisionTrigger(reply);
      } catch (e) {
        if (e.name === 'AbortError') return;
        const msg =
          e.message ||
          'I am having trouble connecting right now. Please try again in a moment.';
        const copy = copyForLang(preferredLanguage);
        pushAssistant(`${copy.networkErrorPrefix} ${msg}`, { speak: false });
      } finally {
        setSending(false);
        abortRef.current = null;
        await resumeVoiceListeningIfNeeded();
      }
    },
    [abortVoiceKickoff, apiBase, attachments, copyForLang, defaultClinicId, preferredLanguage, pushAssistant, publishAssistantVisionTrigger]
  );

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
        await sendUserMessage(said);
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
    sessionIdRef,
    recognitionRef: voiceControllerRef,
    pushAssistant,
    sendUserMessage,
    toggleVoice,
    addFiles
    ,
    preferredLanguage,
    leadText: copyForLang(preferredLanguage).opener
  };
}
