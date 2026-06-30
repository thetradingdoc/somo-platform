import { useEffect, useRef, useState } from 'react';

const LANG_MAP = { en: 'en-US', sw: 'sw-KE', es: 'es-ES' };
const DEBOUNCE_MS = 800;

export function useBrowserStt({ enabled, locale, onFinal }) {
  const stopRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  const debounceRef = useRef(null);
  const bufferRef = useRef('');
  const [listening, setListening] = useState(false);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (!enabled) {
      setListening(false);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      bufferRef.current = '';
      return undefined;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return undefined;

    const flushBuffer = () => {
      const text = bufferRef.current.trim();
      bufferRef.current = '';
      debounceRef.current = null;
      if (text) onFinalRef.current?.(text);
    };

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
        if (!text) return;
        bufferRef.current = bufferRef.current ? `${bufferRef.current} ${text}` : text;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(flushBuffer, DEBOUNCE_MS);
      }
    };
    rec.onerror = () => setListening(false);
    try {
      rec.start();
    } catch (_) {}
    stopRef.current = () => {
      try { rec.stop(); } catch (_) {}
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        flushBuffer();
      }
    };
    return () => {
      stopRef.current?.();
      stopRef.current = null;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      bufferRef.current = '';
      setListening(false);
    };
  }, [enabled, locale]);

  return { stopRef, listening };
}

export function sttSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
