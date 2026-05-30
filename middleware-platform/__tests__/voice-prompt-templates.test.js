'use strict';

const { getDefaultCustomPrompt, normalizeUseCase } = require('../services/voice-prompt-templates');

describe('voice-prompt-templates', () => {
  test('normalizeUseCase maps healthcare aliases', () => {
    expect(normalizeUseCase('healthcare')).toBe('healthcare_clinic');
    expect(normalizeUseCase('dermatology')).toBe('dermatology');
  });

  test('getDefaultCustomPrompt returns derm template', () => {
    const p = getDefaultCustomPrompt({ use_case: 'dermatology' });
    expect(p).toMatch(/dermatology/i);
  });
});
