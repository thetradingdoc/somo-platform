import { setAssistantSpeaking } from './sphereConversationBridge';

/**
 * Speak assistant text with the browser (Web Speech API).
 * Uses en-US so replies match the landing copy; cancel any in-flight utterance first.
 *
 * Note: Kelly only returns text over HTTP — there is no server audio stream. This is the only
 * “voice” unless you add streaming TTS (e.g. ElevenLabs). On some browsers (especially Safari),
 * speech may not start if `speak()` runs only after a long async gap; `voiceschanged` helps iOS.
 */
let activeAudio = null;
let activeAudioUrl = null;
let activeUtterance = null;

function browserSpeechFallback(text, lang) {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
    const u = new window.SpeechSynthesisUtterance(String(text || ''));
    u.lang = String(lang || 'en-US');
    u.rate = 1.0;
    u.pitch = 1.0;
    activeUtterance = u;
    u.onstart = () => setAssistantSpeaking(true);
    const done = () => {
      setAssistantSpeaking(false);
      if (activeUtterance === u) activeUtterance = null;
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
    return true;
  } catch (_) {
    return false;
  }
}

export async function speakAssistantReply(text, { lang = 'en-US', apiBase = '' } = {}) {
  if (typeof window === 'undefined') return;
  const t = String(text || '').trim();
  if (!t) return;
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) return;
  stopAssistantSpeech();
  try {
    const r = await fetch(`${base}/api/public/landing-assistant/tts-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ text: t, lang })
    });
    if (!r.ok) {
      browserSpeechFallback(t, lang);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    activeAudioUrl = url;
    audio.onplay = () => setAssistantSpeaking(true);
    const clear = () => {
      setAssistantSpeaking(false);
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) {
        URL.revokeObjectURL(url);
        activeAudioUrl = null;
      }
    };
    audio.onended = clear;
    audio.onerror = clear;
    await audio.play().catch(() => {
      clear();
      browserSpeechFallback(t, lang);
    });
  } catch (_) {
    if (!browserSpeechFallback(t, lang)) setAssistantSpeaking(false);
  }
}

export function stopAssistantSpeech() {
  if (typeof window === 'undefined') return;
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch (_) {}
    activeAudio = null;
  }
  if (activeAudioUrl) {
    try { URL.revokeObjectURL(activeAudioUrl); } catch (_) {}
    activeAudioUrl = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  activeUtterance = null;
  setAssistantSpeaking(false);
}

export async function waitForAssistantSpeechToFinish({ timeoutMs = 8000 } = {}) {
  if (typeof window === 'undefined') return;
  const start = Date.now();
  while (activeAudio && !activeAudio.paused) {
    if (Date.now() - start > timeoutMs) break;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
}
