export function createWebVoiceTurnController({
  lang = 'en-US',
  onInterim = () => {},
  onFinal = () => {},
  onFatalError = () => {},
  onBargeIn = () => {},
  interruptionMinChars = 4,
  restartDelayMs = 90,
  minFinalChars = 2
} = {}) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) return null;

  const recognition = new SR();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  let active = false;
  let pausedForAssistant = false;
  let finalQueue = [];
  let bargeInFired = false;

  const flushQueue = async () => {
    if (!finalQueue.length) return;
    const next = finalQueue.join(' ').trim();
    finalQueue = [];
    if (next) await onFinal(next);
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const tr = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += tr;
      else interim += tr;
    }

    const cleanInterim = String(interim || '').trim();
    if (cleanInterim) {
      onInterim(cleanInterim);
      if (pausedForAssistant && !bargeInFired && cleanInterim.length >= interruptionMinChars) {
        bargeInFired = true;
        try { onBargeIn(cleanInterim); } catch (_) {}
      }
    }

    const cleanFinal = String(finalText || '').trim();
    if (!cleanFinal || cleanFinal.length < minFinalChars) return;
    if (pausedForAssistant) {
      finalQueue.push(cleanFinal);
      return;
    }
    void onFinal(cleanFinal);
  };

  recognition.onerror = (ev) => {
    const code = ev && ev.error ? String(ev.error) : '';
    if (code === 'no-speech' || code === 'aborted') return;
    active = false;
    onFatalError(code || 'unknown');
  };

  recognition.onend = () => {
    if (!active) return;
    window.setTimeout(() => {
      if (!active) return;
      try { recognition.start(); } catch (_) {}
    }, restartDelayMs);
  };

  return {
    start() {
      active = true;
      try { recognition.start(); } catch (_) {}
    },
    stop() {
      active = false;
      pausedForAssistant = false;
      finalQueue = [];
      bargeInFired = false;
      try { recognition.stop(); } catch (_) {}
    },
    pauseForAssistant() {
      pausedForAssistant = true;
      bargeInFired = false;
    },
    async resumeAfterAssistant({ flush = true } = {}) {
      pausedForAssistant = false;
      bargeInFired = false;
      if (flush) await flushQueue();
    },
    isPaused() {
      return pausedForAssistant;
    }
  };
}
