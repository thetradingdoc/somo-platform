'use strict';

const {
  containsDiagnosisLanguage,
  sanitizeDiagnosisLanguage,
  ABSTAIN_REPLY
} = require('../services/health-diagnosis-guard');

describe('health-diagnosis-guard', () => {
  test('flags definitive diagnosis phrases', () => {
    expect(containsDiagnosisLanguage('You have eczema.')).toBe(true);
    expect(containsDiagnosisLanguage('This is psoriasis.')).toBe(true);
    expect(containsDiagnosisLanguage('It looks like eczema disease.')).toBe(true);
  });

  test('allows educational hedge language', () => {
    expect(containsDiagnosisLanguage('Rashes can sometimes be associated with dry skin.')).toBe(false);
    expect(containsDiagnosisLanguage('It may be worth discussing with a clinician.')).toBe(false);
  });

  test('sanitize replaces blocked text with abstain copy', () => {
    const out = sanitizeDiagnosisLanguage('You have a fungal infection.');
    expect(out.blocked).toBe(true);
    expect(out.text).toBe(ABSTAIN_REPLY);
  });
});
