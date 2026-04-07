const DEFAULT_BY_LANG = {
  en: { sttLang: 'en-US', interruptionMinChars: 4, minFinalChars: 2, restartDelayMs: 90 },
  fr: { sttLang: 'fr-FR', interruptionMinChars: 5, minFinalChars: 2, restartDelayMs: 100 },
  sw: { sttLang: 'sw-KE', interruptionMinChars: 5, minFinalChars: 2, restartDelayMs: 110 },
  ru: { sttLang: 'ru-RU', interruptionMinChars: 5, minFinalChars: 2, restartDelayMs: 100 }
};

function toLangCode(lang) {
  return String(lang || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
}

function readNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveTryNowVoiceConfig(langCode, env = process.env) {
  const code = toLangCode(langCode);
  const base = DEFAULT_BY_LANG[code] || DEFAULT_BY_LANG.en;
  return {
    sttLang: base.sttLang,
    interruptionMinChars: readNum(env.REACT_APP_TRYNOW_INTERRUPT_MIN_CHARS, base.interruptionMinChars),
    minFinalChars: readNum(env.REACT_APP_TRYNOW_MIN_FINAL_CHARS, base.minFinalChars),
    restartDelayMs: readNum(env.REACT_APP_TRYNOW_STT_RESTART_DELAY_MS, base.restartDelayMs)
  };
}

