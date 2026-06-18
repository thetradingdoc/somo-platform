'use strict';

const { resolveSpecialtyToUseCase } = require('../services/prompt-profile-templates');

describe('resolveSpecialtyToUseCase', () => {
  test('maps dermatology specialty to dermatology use case', () => {
    expect(resolveSpecialtyToUseCase('Dermatology')).toBe('dermatology');
    expect(resolveSpecialtyToUseCase('skin care clinic')).toBe('dermatology');
  });

  test('falls back to healthcare_clinic for unknown specialty', () => {
    expect(resolveSpecialtyToUseCase('Podiatry')).toBe('healthcare_clinic');
    expect(resolveSpecialtyToUseCase('', 'small_business')).toBe('small_business');
  });
});
