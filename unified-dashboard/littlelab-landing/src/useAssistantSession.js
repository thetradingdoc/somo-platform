import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getOrCreateLandingSessionId,
  resolveMiddlewareApiBase,
  sendLandingAssistantTurn
} from './landingAssistantApi';
import { speakAssistantReply, stopAssistantSpeech } from './assistantSpeech';

const INITIAL_ASSISTANT =
  'Hi — I’m your Skin & Care assistant. Ask about your skin, routine, or ingredients; I’ll analyze your questions and summarize guidance here. Tap the mic once to talk — it stays on until you tap again, or open chat to type.';

/** Synthetic user turn for Kelly when the mic is turned on (not shown as a user bubble in the UI). */
const VOICE_KICKOFF_MESSAGE =
  '[Voice] The user just activated the microphone. Reply in English only with one short, friendly sentence inviting them to ask their skincare or routine question out loud.';

/**
 * Shared assistant state for voice page + chat page (same session_id and message list).
 */
export function useAssistantSession() {
  const apiBase = useMemo(() => resolveMiddlewareApiBase(), []);
  const defaultClinicId = useMemo(() => (process.env.REACT_APP_DEFAULT_CLINIC_ID || '').trim() || null, []);

  const [messages, setMessages] = useState(() => [
    { id: 'm0', role: 'assistant', text: INITIAL_ASSISTANT }
  ]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [interimCaption, setInterimCaption] = useState('');
  const [sending, setSending] = useState(false);
  const sessionIdRef = useRef(null);
  const abortRef = useRef(null);
  const voiceKickoffAbortRef = useRef(null);
  const recognitionRef = useRef(null);
  /** User turned the mic on — keep listening across utterances until they turn it off. */
  const voiceSessionActiveRef = useRef(false);
  /** After final speech, we stop recognition until the assistant reply finishes (reduces TTS echo). */
  const voiceResumeAfterSendRef = useRef(false);
  /** True while waiting for API/TTS so `onend` does not immediately restart recognition. */
  const voicePauseForSendRef = useRef(false);

  useEffect(() => {
    sessionIdRef.current = getOrCreateLandingSessionId();
  }, []);

  const pushAssistant = useCallback((text, { speak = true } = {}) => {
    setMessages((prev) => [...prev, { id: `m${Date.now()}_${Math.random()}`, role: 'assistant', text }]);
    if (speak && text !== INITIAL_ASSISTANT) {
      speakAssistantReply(text);
    }
  }, []);

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
    if (!apiBase) {
      pushAssistant("I'm listening — go ahead and ask your question.");
      return;
    }
    const ac = new AbortController();
    voiceKickoffAbortRef.current = ac;
    try {
      const sid = sessionIdRef.current || getOrCreateLandingSessionId();
      sessionIdRef.current = sid;
      const data = await sendLandingAssistantTurn({
        apiBase,
        message: VOICE_KICKOFF_MESSAGE,
        sessionId: sid,
        clinicId: defaultClinicId,
        preferredLanguage: 'en',
        signal: ac.signal
      });
      if (voiceKickoffAbortRef.current !== ac) return;
      voiceKickoffAbortRef.current = null;
      if (data.session_id) {
        sessionIdRef.current = data.session_id;
        try {
          sessionStorage.setItem('littlelab_landing_assistant_sid', data.session_id);
        } catch (_) {}
      }
      const reply =
        (data.reply && String(data.reply).trim()) || "I'm listening — what would you like to know?";
      pushAssistant(reply);
    } catch (e) {
      if (e.name === 'AbortError') return;
      voiceKickoffAbortRef.current = null;
      pushAssistant("I'm listening — go ahead when you're ready.");
    }
  }, [abortVoiceKickoff, apiBase, defaultClinicId, pushAssistant]);

  const sendUserMessage = useCallback(
    async (text) => {
      abortVoiceKickoff();

      const shouldResumeVoiceListening = voiceResumeAfterSendRef.current;
      voiceResumeAfterSendRef.current = false;

      const resumeVoiceListeningIfNeeded = () => {
        if (!shouldResumeVoiceListening || !voiceSessionActiveRef.current) return;
        voicePauseForSendRef.current = false;
        window.setTimeout(() => {
          if (!voiceSessionActiveRef.current || !recognitionRef.current) return;
          try {
            recognitionRef.current.start();
          } catch (_) {}
        }, 1050);
      };

      const t = String(text || '').trim();
      const names = attachments.map((a) => a.name).filter(Boolean);
      if (!t && names.length === 0) return;

      const display =
        t + (names.length ? `${t ? '\n\n' : ''}[Attached: ${names.join(', ')}]` : '');

      setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', text: display }]);
      setInput('');
      setAttachments([]);

      if (names.length && !t) {
        window.setTimeout(() => {
          pushAssistant(
            'Thanks — I received your file(s). Full image analysis runs in the signed-in patient flow; here I can answer general education questions about skincare.'
          );
          resumeVoiceListeningIfNeeded();
        }, 400);
        return;
      }

      if (!apiBase) {
        window.setTimeout(() => {
          if (names.length) {
            pushAssistant(
              'Thanks — I received your file(s). Full image analysis runs in the signed-in patient flow; here I can answer general education questions about skincare.'
            );
          } else {
            pushAssistant(
              'This demo isn’t connected to the live API. Set REACT_APP_API_BASE to your middleware URL (e.g. http://localhost:4000) for real replies.'
            );
          }
          resumeVoiceListeningIfNeeded();
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
        const data = await sendLandingAssistantTurn({
          apiBase,
          message: t,
          sessionId: sid,
          clinicId: defaultClinicId,
          preferredLanguage: 'en',
          signal: ac.signal
        });
        if (data.session_id) {
          sessionIdRef.current = data.session_id;
          try {
            sessionStorage.setItem('littlelab_landing_assistant_sid', data.session_id);
          } catch (_) {}
        }
        const reply = (data.reply && String(data.reply).trim()) || 'I’m here. How can I help?';
        // Keep chat-only turns silent; only speak while an active voice session is on.
        pushAssistant(reply, { speak: voiceSessionActiveRef.current });
      } catch (e) {
        if (e.name === 'AbortError') return;
        const msg =
          e.message ||
          'Something went wrong reaching the assistant. Check that the middleware is running and DEFAULT_CLINIC_ID is set.';
        pushAssistant(`Sorry — I couldn’t reach the assistant just now. ${msg}`, { speak: false });
      } finally {
        setSending(false);
        abortRef.current = null;
        resumeVoiceListeningIfNeeded();
      }
    },
    [abortVoiceKickoff, apiBase, attachments, defaultClinicId, pushAssistant]
  );

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return undefined;
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const tr = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += tr;
        else interim += tr;
      }
      if (interim) setInterimCaption(interim);
      if (finalText.trim()) {
        const said = finalText.trim();
        setInterimCaption('');
        voiceResumeAfterSendRef.current = voiceSessionActiveRef.current;
        voicePauseForSendRef.current = true;
        try {
          r.stop();
        } catch (_) {}
        sendUserMessage(said);
      }
    };
    r.onerror = (ev) => {
      const code = ev && ev.error ? String(ev.error) : '';
      if (code === 'no-speech' || code === 'aborted') return;
      voiceSessionActiveRef.current = false;
      setVoiceActive(false);
      setInterimCaption('');
    };
    r.onend = () => {
      if (!voiceSessionActiveRef.current) {
        setVoiceActive(false);
        setInterimCaption('');
        return;
      }
      if (voicePauseForSendRef.current) return;
      window.setTimeout(() => {
        if (!voiceSessionActiveRef.current || voicePauseForSendRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
        } catch (_) {}
      }, 160);
    };
    recognitionRef.current = r;
    return () => {
      try {
        r.abort();
      } catch (_) {}
    };
  }, [sendUserMessage]);

  const toggleVoice = useCallback(
    (onUnsupported) => {
      const r = recognitionRef.current;
      if (!r) {
        pushAssistant('Voice input isn’t supported in this browser. Open chat to type your message.', {
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
        try {
          r.stop();
        } catch (_) {}
        setVoiceActive(false);
        setInterimCaption('');
        return;
      }
      setInterimCaption('');
      stopAssistantSpeech();
      voiceSessionActiveRef.current = true;
      voicePauseForSendRef.current = false;
      setVoiceActive(true);
      try {
        r.start();
      } catch (_) {
        setVoiceActive(false);
        return;
      }
      void requestVoiceKickoff();
    },
    [abortVoiceKickoff, pushAssistant, requestVoiceKickoff, voiceActive]
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
    recognitionRef,
    pushAssistant,
    sendUserMessage,
    toggleVoice,
    addFiles
  };
}
