/**
 * Extract language requirements from job posting title/description.
 * Used for bilingual receptionist roles (Russian, Mandarin, Spanish, etc.).
 */

const LANGUAGE_RULES = [
  { pattern: /\brussian\b|\bрусск/i, code: 'ru', label: 'Russian' },
  { pattern: /\bmandarin\b|\bputonghua\b|\bcantonese\b|\bchinese\b|\b中文\b|\b普通话\b|\b国语\b/i, code: 'zh', label: 'Mandarin' },
  { pattern: /\bspanish\b|\bespañol\b|\bespanol\b|\bcastilian\b/i, code: 'es', label: 'Spanish' },
  { pattern: /\bfrench\b|\bfrançais\b|\bfrancais\b/i, code: 'fr', label: 'French' },
  { pattern: /\bportuguese\b|\bportuguês\b|\bportugues\b/i, code: 'pt', label: 'Portuguese' },
  { pattern: /\barabic\b|\bعرب/i, code: 'ar', label: 'Arabic' },
  { pattern: /\bkorean\b|\b한국/i, code: 'ko', label: 'Korean' },
  { pattern: /\bjapanese\b|\b日本語\b|\bnihongo\b/i, code: 'ja', label: 'Japanese' },
  { pattern: /\bvietnamese\b|\btiếng việt\b|\btieng viet\b/i, code: 'vi', label: 'Vietnamese' },
  { pattern: /\btagalog\b|\bfilipino\b|\bpilipino\b/i, code: 'tl', label: 'Tagalog' },
  { pattern: /\bhindi\b|\bहिन्दी\b|\bहिंदी\b/i, code: 'hi', label: 'Hindi' },
  { pattern: /\burguah\b|\burguayan\b/i, code: 'es', label: 'Spanish' },
  { pattern: /\bpolish\b|\bpolski\b/i, code: 'pl', label: 'Polish' },
  { pattern: /\bitalian\b|\bitaliano\b/i, code: 'it', label: 'Italian' },
  { pattern: /\bgerman\b|\bdeutsch\b/i, code: 'de', label: 'German' },
  { pattern: /\bhebrew\b|\bעברית\b/i, code: 'he', label: 'Hebrew' },
  { pattern: /\bgreek\b|\bελληνικά\b/i, code: 'el', label: 'Greek' },
  { pattern: /\burdu\b|\bاردو\b/i, code: 'ur', label: 'Urdu' },
  { pattern: /\bbengali\b|\bবাংলা\b/i, code: 'bn', label: 'Bengali' },
  { pattern: /\bpunjabi\b|\bਪੰਜਾਬੀ\b/i, code: 'pa', label: 'Punjabi' },
  { pattern: /\bcreole\b|\bhaitian creole\b/i, code: 'ht', label: 'Haitian Creole' },
];

const BILINGUAL_HINT = /\bbilingual\b|\bmulti[- ]?lingual\b|\bfluent in\b|\bmust speak\b|\brequired to speak\b|\blanguage preference\b|\blanguage requirements?\b|\bspeak (?:both|english and)\b|\benglish and [a-z]+(?:\s+[a-z]+)?\b/i;

function normalizeText(title, description) {
  return [title, description].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {{ required_languages: string[], language_codes: string[], preferred_language: string|null, language_summary: string|null, is_bilingual: boolean }}
 */
function extractLanguagesFromJob({ title = '', description = '', snippet = '' } = {}) {
  const text = normalizeText(title, description || snippet);
  if (!text || text.length < 8) {
    return emptyResult();
  }

  const lower = text.toLowerCase();
  const is_bilingual = BILINGUAL_HINT.test(lower);

  const labels = [];
  const codes = [];
  const seenCodes = new Set();

  for (const rule of LANGUAGE_RULES) {
    if (rule.pattern.test(text) && !seenCodes.has(rule.code)) {
      labels.push(rule.label);
      codes.push(rule.code);
      seenCodes.add(rule.code);
    }
  }

  if (!labels.length && !is_bilingual) {
    return emptyResult();
  }

  const preferred_language = pickPreferredLanguage(codes, lower);
  const language_summary = buildLanguageSummary(labels, is_bilingual);

  return {
    required_languages: labels,
    language_codes: codes,
    preferred_language,
    language_summary,
    is_bilingual: is_bilingual || labels.length > 1,
  };
}

function pickPreferredLanguage(codes, lower) {
  if (!codes.length) {
    if (/\bbilingual\b|\bspanish\b|\bespañol\b/.test(lower)) return 'es';
    if (/\brussian\b/.test(lower)) return 'ru';
    if (/\bmandarin\b|\bchinese\b|\bcantonese\b/.test(lower)) return 'zh';
    return null;
  }
  const nonEnglish = codes.find((c) => c !== 'en');
  return nonEnglish || codes[0] || 'en';
}

function buildLanguageSummary(labels, isBilingual) {
  if (!labels.length) {
    return isBilingual ? 'Bilingual required (language not specified)' : null;
  }
  if (labels.length === 1) {
    return isBilingual ? `Bilingual — ${labels[0]} required` : `${labels[0]} preferred`;
  }
  return `${labels.join(', ')} required`;
}

function emptyResult() {
  return {
    required_languages: [],
    language_codes: [],
    preferred_language: null,
    language_summary: null,
    is_bilingual: false,
  };
}

function parseRequiredLanguages(stored) {
  if (!stored) return [];
  if (Array.isArray(stored)) return stored;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(stored).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

/**
 * Retell dynamic variable — tells the sales agent how to open the call.
 */
function buildLanguageInstruction(lead) {
  const labels = parseRequiredLanguages(lead?.required_languages);
  const code = lead?.preferred_language || pickPreferredLanguage(
    labels.map((l) => LANGUAGE_RULES.find((r) => r.label === l)?.code).filter(Boolean),
    ''
  );

  if (!labels.length) {
    return 'Respond in English unless the contact asks for another language.';
  }

  const primary = labels[0];
  if (labels.length === 1) {
    return `The job posting requires ${primary}. Open or continue the call in ${primary} when speaking with the front desk (language code: ${code || 'unknown'}).`;
  }

  return `The job posting requires these languages: ${labels.join(', ')}. Prefer ${primary} when appropriate (code: ${code || 'unknown'}). Offer to continue in any listed language if useful.`;
}

module.exports = {
  extractLanguagesFromJob,
  parseRequiredLanguages,
  buildLanguageInstruction,
  LANGUAGE_RULES,
};
