'use strict';

const {
  extractZip,
  extractPlanHint,
  extractCareNeed,
  extractSpecialty,
  wantsBenefits,
  wantsContactInfo
} = require('../services/navigation/navigation-intent-parser');

describe('navigation-intent-parser', () => {
  test('extracts metro plan', () => {
    expect(extractPlanHint('I have Metro Health Plus')).toBe('Metro Health Plus');
  });

  test('extracts zip', () => {
    expect(extractZip('I am in 10001')).toBe('10001');
  });

  test('extracts dental specialty', () => {
    expect(extractSpecialty('I need a dentist')).toBe('Dental');
  });

  test('maps braces to orthodontics', () => {
    const need = extractCareNeed('my kid needs braces');
    expect(need.specialty).toBe('Orthodontics');
    expect(need.label).toMatch(/braces/i);
  });

  test('maps anxiety to psychiatry', () => {
    expect(extractCareNeed("I've been anxious").specialty).toBe('Psychiatry');
  });

  test('detects benefits question', () => {
    expect(wantsBenefits("what's covered?")).toBe(true);
  });

  test('detects contact info request', () => {
    expect(wantsContactInfo('yes, phone number please')).toBe(true);
  });
});
