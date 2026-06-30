import { useCallback } from 'react';
import { speakKelly } from './kellyTts.js';

export function useKellyTts({ enabled, locale = 'en' } = {}) {
  const maybeSpeak = useCallback((text) => {
    if (!enabled) return;
    speakKelly(text, locale);
  }, [enabled, locale]);

  return { maybeSpeak };
}
