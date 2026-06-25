import { useEffect, useRef, useState } from 'react';

const LANG_MAP = { en: 'en-US', sw: 'sw-KE', es: 'es-ES' };

export function useBrowserStt({ enabled, locale, onFinal }) {
  const stopRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  const [listening, setListening] = useState(false);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (!enabled) {
      setListening(false);
      return undefined;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return undefined;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = LANG_MAP[locale] || 'en-US';
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last?.isFinal) {
        const text = last[0]?.transcript?.trim();
        if (text) onFinalRef.current?.(text);
      }
    };
    rec.onerror = () => setListening(false);
    try {
      rec.start();
    } catch (_) {}
    stopRef.current = () => {
      try { rec.stop(); } catch (_) {}
    };
    return () => {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
    };
  }, [enabled, locale]);

  return { stopRef, listening };
}

export function sttSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
