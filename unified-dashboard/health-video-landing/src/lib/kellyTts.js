/**
 * Optional browser TTS for Kelly (Post-MVP F-2). Free via speechSynthesis.
 */
export function speakKelly(text, locale = 'en') {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  if (!text?.trim()) return false;
  const utter = new SpeechSynthesisUtterance(text.trim());
  const langMap = { en: 'en-US', sw: 'sw-KE', es: 'es-ES' };
  utter.lang = langMap[locale] || 'en-US';
  utter.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  return true;
}
