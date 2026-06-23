'use strict';

/** Kelly Rails Phase C — single source for language detection + preference requests. */

const SPANISH_HINTS = [
  'hola', 'buenos', 'buenas', 'dolor', 'fiebre', 'tos', 'quiero',
  'cita', 'doctor', 'pagar', 'factura', 'ayuda', 'gracias', 'por favor'
];
const PORTUGUESE_HINTS = [
  'ola', 'olá', 'dor', 'febre', 'consulta', 'marcar', 'pagar', 'fatura',
  'obrigado', 'por favor', 'ajuda'
];
const MANDARIN_HINTS = ['你好', '医生', '预约', '疼', '发烧', '付款', '谢谢'];

const LANGUAGE_NAME_TO_CODE = {
  swahili: 'sw',
  kiswahili: 'sw',
  spanish: 'es',
  español: 'es',
  english: 'en',
  russian: 'ru',
  french: 'fr',
  français: 'fr',
  chinese: 'zh',
  mandarin: 'zh',
  german: 'de',
  deutsch: 'de',
  arabic: 'ar',
  portuguese: 'pt',
  vietnamese: 'vi',
  hindi: 'hi',
  tagalog: 'tl',
  korean: 'ko',
  japanese: 'ja'
};

function minLanguageConfidence() {
  const v = parseFloat(process.env.KELLY_LANG_MIN_CONFIDENCE || '0.6');
  return Number.isFinite(v) ? v : 0.6;
}

const LANGUAGE_DISPLAY_NAMES = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  zh: 'Chinese',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  sw: 'Swahili',
  ar: 'Arabic'
};

function displayName(code) {
  return LANGUAGE_DISPLAY_NAMES[code] || code;
}

function hintScore(lower, hints) {
  return hints.reduce((n, h) => (lower.includes(h) ? n + 1 : n), 0);
}

/**
 * Rails v2 first-turn detection with confidence (hint-based).
 */
function detectLanguage(message) {
  const text = String(message || '').trim();
  if (!text) return { language: 'en', confidence: 0 };
  const lower = text.toLowerCase();

  if (MANDARIN_HINTS.some((h) => text.includes(h))) {
    return { language: 'zh', confidence: 0.95 };
  }
  const ptScore = hintScore(lower, PORTUGUESE_HINTS);
  const esScore = hintScore(lower, SPANISH_HINTS);
  if (ptScore > esScore && ptScore > 0) {
    return { language: 'pt', confidence: Math.min(0.95, 0.65 + ptScore * 0.08) };
  }
  if (esScore > 0) {
    return { language: 'es', confidence: Math.min(0.95, 0.7 + esScore * 0.08) };
  }
  const fromText = detectLanguageFromText(text);
  if (fromText.language !== 'en') {
    return { language: fromText.language, confidence: 0.9 };
  }
  return { language: 'en', confidence: 0.75 };
}

/**
 * Script / phrase heuristics (chat + voice).
 */
function detectLanguageFromText(text) {
  const t = String(text || '').trim();
  if (!t) return { language: 'en', name: 'English', confidence: 0.5 };

  const lower = t.toLowerCase();
  if (/\p{Script=Cyrillic}/u.test(t)) {
    return { language: 'ru', name: 'Russian', confidence: 0.92 };
  }
  if (/\p{Script=Han}/u.test(t) || /[\u4e00-\u9fff]/.test(t)) {
    return { language: 'zh', name: 'Chinese', confidence: 0.95 };
  }
  if (/^(hola|buenos|gracias|por favor|quiero|necesito|dolor|sí|no)\b/i.test(lower) || /español/i.test(lower)) {
    return { language: 'es', name: 'Spanish', confidence: 0.9 };
  }
  if (PORTUGUESE_HINTS.some((h) => lower.includes(h))) {
    return { language: 'pt', name: 'Portuguese', confidence: 0.85 };
  }
  if (/^(bonjour|merci|je veux|j'ai|oui|non)\b/i.test(lower) || /français/i.test(lower)) {
    return { language: 'fr', name: 'French', confidence: 0.9 };
  }
  if (/^(guten|danke|ich|hallo|ja|nein)\b/i.test(lower) || /deutsch|german/i.test(lower)) {
    return { language: 'de', name: 'German', confidence: 0.9 };
  }
  if (/\bswahili|kiswahili\b/i.test(lower)) {
    return { language: 'sw', name: 'Swahili', confidence: 0.9 };
  }
  return { language: 'en', name: 'English', confidence: 0.75 };
}

function detectLanguagePreferenceRequest(message) {
  const m = String(message || '').trim();
  const lower = m.toLowerCase();

  const swahiliLangPatterns = [
    { re: /(?:tunaweza|naweza|weza)\s+ongea\s+(?:ki)?swahili/i, code: 'sw', name: 'Swahili' },
    { re: /ongea\s+(?:ki)?swahili/i, code: 'sw', name: 'Swahili' }
  ];
  for (const { re, code, name } of swahiliLangPatterns) {
    if (re.test(lower)) return { isLanguageRequest: true, code, name };
  }

  const russianLangPatterns = [
    { re: /(?:можем|можно)\s+(?:говорить|общаться)\s+(?:по-русски|на\s+русском)/i, code: 'ru', name: 'Russian' },
    { re: /\b(?:говорить|говорите)\s+по-русски\b/i, code: 'ru', name: 'Russian' },
    { re: /\bпереключ(?:итесь|ись)\s+на\s+русский\b/i, code: 'ru', name: 'Russian' }
  ];
  for (const { re, code, name } of russianLangPatterns) {
    if (re.test(m)) return { isLanguageRequest: true, code, name };
  }

  const NOT_LANGUAGE = new Set([
    'my', 'your', 'their', 'his', 'her', 'the', 'a', 'an', 'this', 'that',
    'order', 'way', 'mind', 'detail', 'general', 'particular'
  ]);
  const patterns = [
    /\b(?:can you|could you|can we|could we)\s+speak\s+(?:in\s+)?(\w+)/i,
    /\b(?:can you|could you|can we|could we)\s+talk\s+(?:in\s+)?(\w+)/i,
    /\b(?:can you|could you|can we|could we)\s+(?:speak|talk)\s+(?:in\s+)?(russian|spanish|french|english|swahili|german|chinese|arabic|portuguese)\b/i,
    /\bswitch\s+(?:the\s+)?(?:language\s+)?to\s+(russian|spanish|french|english|swahili|german|chinese)\b/i,
    /\b(?:use|prefer)\s+(russian|spanish|french|english|swahili)\b/i,
    /\bspeak\s+(?:in\s+)?(\w+)\s*(?:please)?/i,
    /\b(?:respond|reply|answer|write)\s+(?:in\s+)?(\w+)/i,
    /\bI\s+(?:don'?t\s+)?speak\s+(\w+)/i,
    /\b(?:please\s+)?(english|spanish|french|german|russian|chinese|swahili)\s+please\b/i,
    /\b(?:language|lang)\s*[:\s]?\s*(\w+)/i
  ];
  for (const re of patterns) {
    const match = lower.match(re);
    if (match && match[1]) {
      const lang = match[1].toLowerCase();
      if (NOT_LANGUAGE.has(lang)) continue;
      const code = LANGUAGE_NAME_TO_CODE[lang] || (lang.length >= 2 ? lang.substring(0, 2) : null);
      if (code) return { isLanguageRequest: true, code, name: lang };
    }
  }
  return { isLanguageRequest: false };
}

/**
 * First-turn gate for kelly-turn-resolver (v2 path).
 */
function evaluateFirstTurnLanguage(message) {
  const pref = detectLanguagePreferenceRequest(message);
  if (pref.isLanguageRequest && pref.code && pref.code !== 'en') {
    return {
      language: pref.code,
      confidence: 0.95,
      forceLanguageHandoff: false,
      explicitPreference: true
    };
  }
  const detected = detectLanguage(message);
  const forceLanguageHandoff =
    detected.confidence < minLanguageConfidence() && detected.language !== 'en';
  return { ...detected, forceLanguageHandoff, explicitPreference: false };
}

module.exports = {
  detectLanguage,
  detectLanguageFromText,
  detectLanguagePreferenceRequest,
  evaluateFirstTurnLanguage,
  minLanguageConfidence,
  displayName,
  LANGUAGE_NAME_TO_CODE
};
