import { setAssistantSpeaking } from './sphereConversationBridge';

/**
 * Speak assistant text with the browser (Web Speech API).
 * Uses en-US so replies match the landing copy; cancel any in-flight utterance first.
 *
 * Note: Kelly only returns text over HTTP — there is no server audio stream. This is the only
 * “voice” unless you add streaming TTS (e.g. ElevenLabs). On some browsers (especially Safari),
 * speech may not start if `speak()` runs only after a long async gap; `voiceschanged` helps iOS.
 */
export function speakAssistantReply(text, { lang = 'en-US' } = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const t = String(text || '').trim();
  if (!t) return;

  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
    setAssistantSpeaking(false);
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    u.rate = 1;
    u.onstart = () => setAssistantSpeaking(true);
    u.onend = () => setAssistantSpeaking(false);
    u.onerror = () => setAssistantSpeaking(false);
    const voices = window.speechSynthesis.getVoices();
    const prefix = lang.slice(0, 2).toLowerCase();
    const match = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
    if (match) u.voice = match;
    try {
      window.speechSynthesis.speak(u);
    } catch (_) {}
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.addEventListener('voiceschanged', go, { once: true });
    window.setTimeout(go, 400);
  } else {
    go();
  }
}

export function stopAssistantSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch (_) {}
  setAssistantSpeaking(false);
}
