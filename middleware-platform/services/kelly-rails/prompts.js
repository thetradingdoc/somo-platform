'use strict';

const en = require('./prompts/en');
const es = require('./prompts/es');
const zh = require('./prompts/zh');
const ru = require('./prompts/ru');
const { parseSupportedLanguages } = require('../tenant-language-config');

const PROMPT_MODULES = { en, es, zh, ru };

function resolveLocale(state = {}, opts = {}, tenantLanguages = null) {
  const sticky = String(state.locale || opts.locale || state.flags?.locale || 'en').slice(0, 2);
  const allowed = parseSupportedLanguages(tenantLanguages || opts.supported_languages || ['en', 'es', 'zh', 'ru']);
  if (allowed.includes(sticky)) return sticky;
  if (allowed.includes('en')) return 'en';
  return allowed[0] || 'en';
}

function laneSystemPrompt(lane, step, state, providerCtx = {}, localeOpt, tenantLanguages = null) {
  const locale = localeOpt || resolveLocale(state, providerCtx, tenantLanguages);
  const mod = PROMPT_MODULES[locale] || en;
  return mod.laneSystemPrompt(lane, step, state, providerCtx);
}

function getTenantLanguagesFromDb(db, { clinicId, customerId, merchantId } = {}) {
  try {
    const { resolveTenantVoiceConfig } = require('../tenant-voice-config');
    const cfg = resolveTenantVoiceConfig(db, { clinicId, customerId, merchantId });
    return parseSupportedLanguages(cfg.supported_languages || cfg.language_mode);
  } catch (_) {
    if (!db?.getVoiceAgentSettingsForProvider) return ['en'];
    const row = db.getVoiceAgentSettingsForProvider({ clinicId, customerId, merchantId });
    return parseSupportedLanguages(row?.supported_languages || row?.language_mode);
  }
}

module.exports = { laneSystemPrompt, resolveLocale, getTenantLanguagesFromDb, PROMPT_MODULES };
