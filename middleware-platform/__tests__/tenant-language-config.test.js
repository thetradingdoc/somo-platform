'use strict';

const {
  normalizeLanguageConfig,
  isLanguageSupported,
  LANGUAGE_PRESETS
} = require('../services/tenant-language-config');
const zh = require('../services/kelly-rails/prompts/zh');
const ru = require('../services/kelly-rails/prompts/ru');
const { PROMPT_MODULES } = require('../services/kelly-rails/prompts');

describe('tenant language config', () => {
  test('en_zh preset includes mandarin', () => {
    expect(LANGUAGE_PRESETS.en_zh).toEqual(['en', 'zh']);
    const cfg = normalizeLanguageConfig({ language_mode: 'en_zh' });
    expect(cfg.supported_languages).toEqual(['en', 'zh']);
  });

  test('unsupported language fails allowlist', () => {
    expect(isLanguageSupported('ru', ['en', 'es'])).toBe(false);
    expect(isLanguageSupported('es', ['en', 'es'])).toBe(true);
  });

  test('zh and ru prompt modules export laneSystemPrompt', () => {
    expect(typeof zh.laneSystemPrompt).toBe('function');
    expect(typeof ru.laneSystemPrompt).toBe('function');
    expect(PROMPT_MODULES.zh).toBe(zh);
    expect(PROMPT_MODULES.ru).toBe(ru);
  });
});
