'use strict';

/** Per-tenant language presets for NYC front desk (Phase 1). */
const LANGUAGE_PRESETS = Object.freeze({
  en_only: ['en'],
  en_es: ['en', 'es'],
  en_ru: ['en', 'ru'],
  en_zh: ['en', 'zh']
});

const PRESET_LABELS = Object.freeze({
  en_only: 'English only',
  en_es: 'English + Spanish',
  en_ru: 'English + Russian',
  en_zh: 'English + Mandarin (Chinese)'
});

const ALLOWED_CODES = new Set(['en', 'es', 'ru', 'zh', 'pt', 'fr', 'de', 'sw', 'ar']);

function languageModeFromLanguages(languages) {
  const sorted = [...new Set((languages || []).map((c) => String(c).slice(0, 2).toLowerCase()))].sort();
  for (const [mode, codes] of Object.entries(LANGUAGE_PRESETS)) {
    const presetSorted = [...codes].sort();
    if (
      sorted.length === presetSorted.length &&
      sorted.every((c, i) => c === presetSorted[i])
    ) {
      return mode;
    }
  }
  return sorted.length === 1 && sorted[0] === 'en' ? 'en_only' : null;
}

function resolveLanguagePreset(mode) {
  const key = String(mode || 'en_only').trim().toLowerCase();
  return LANGUAGE_PRESETS[key] ? [...LANGUAGE_PRESETS[key]] : [...LANGUAGE_PRESETS.en_only];
}

function parseSupportedLanguages(raw) {
  if (!raw) return [...LANGUAGE_PRESETS.en_only];
  if (Array.isArray(raw)) return raw.map((c) => String(c).slice(0, 2).toLowerCase()).filter((c) => ALLOWED_CODES.has(c));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseSupportedLanguages(parsed);
    } catch (_) {
      return raw.split(/[,;\s]+/).map((c) => c.slice(0, 2).toLowerCase()).filter((c) => ALLOWED_CODES.has(c));
    }
  }
  return [...LANGUAGE_PRESETS.en_only];
}

/**
 * Normalize tenant language config from API payload or DB row.
 */
function normalizeLanguageConfig(input = {}) {
  const mode = String(input.language_mode || '').trim().toLowerCase();
  if (mode && LANGUAGE_PRESETS[mode]) {
    return {
      language_mode: mode,
      supported_languages: resolveLanguagePreset(mode)
    };
  }
  const langs = parseSupportedLanguages(input.supported_languages);
  const derived = languageModeFromLanguages(langs);
  return {
    language_mode: derived || 'en_only',
    supported_languages: langs.length ? langs : [...LANGUAGE_PRESETS.en_only]
  };
}

function isLanguageSupported(code, supportedLanguages) {
  const lang = String(code || 'en').slice(0, 2).toLowerCase();
  const allowed = parseSupportedLanguages(supportedLanguages);
  return allowed.includes(lang);
}

function languagesFromProviderProfile(customer) {
  if (!customer?.provider_profile) return null;
  try {
    const profile =
      typeof customer.provider_profile === 'string'
        ? JSON.parse(customer.provider_profile)
        : customer.provider_profile;
    const langs = profile?.languages;
    if (!Array.isArray(langs) || !langs.length) return null;
    const codes = langs
      .map((l) => {
        const s = String(l).toLowerCase();
        if (s.includes('spanish') || s === 'es') return 'es';
        if (s.includes('russian') || s === 'ru') return 'ru';
        if (s.includes('mandarin') || s.includes('chinese') || s === 'zh') return 'zh';
        if (s.includes('english') || s === 'en') return 'en';
        return s.slice(0, 2);
      })
      .filter((c) => ALLOWED_CODES.has(c));
    if (!codes.length) return null;
    if (!codes.includes('en')) codes.unshift('en');
    return normalizeLanguageConfig({ supported_languages: [...new Set(codes)] });
  } catch (_) {
    return null;
  }
}

function getTenantVoiceLanguageConfig(db, { clinicId, customerId, merchantId } = {}) {
  if (!db?.getVoiceAgentSettingsForProvider) {
    return normalizeLanguageConfig({});
  }
  const row = db.getVoiceAgentSettingsForProvider({ clinicId, customerId, merchantId });
  return normalizeLanguageConfig(row || {});
}

module.exports = {
  LANGUAGE_PRESETS,
  PRESET_LABELS,
  resolveLanguagePreset,
  normalizeLanguageConfig,
  isLanguageSupported,
  languageModeFromLanguages,
  parseSupportedLanguages,
  languagesFromProviderProfile,
  getTenantVoiceLanguageConfig
};
