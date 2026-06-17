const {
  extractLanguagesFromJob,
  parseRequiredLanguages,
  buildLanguageInstruction,
} = require('../services/lead-language-extractor');

describe('lead-language-extractor', () => {
  test('detects Russian bilingual requirement', () => {
    const r = extractLanguagesFromJob({
      title: 'Dental Receptionist',
      description: 'Bilingual Russian/English required. Front desk duties.',
    });
    expect(r.required_languages).toContain('Russian');
    expect(r.preferred_language).toBe('ru');
    expect(r.is_bilingual).toBe(true);
  });

  test('detects Mandarin and Spanish', () => {
    const r = extractLanguagesFromJob({
      description: 'Must speak fluent Mandarin and Spanish. Medical office.',
    });
    expect(r.required_languages).toEqual(expect.arrayContaining(['Mandarin', 'Spanish']));
    expect(r.language_codes).toContain('zh');
    expect(r.language_codes).toContain('es');
  });

  test('returns empty when no language signals', () => {
    const r = extractLanguagesFromJob({
      description: 'Answer phones and schedule appointments.',
    });
    expect(r.required_languages).toHaveLength(0);
    expect(r.preferred_language).toBeNull();
  });

  test('buildLanguageInstruction for outbound agent', () => {
    const text = buildLanguageInstruction({
      required_languages: '["Russian"]',
      preferred_language: 'ru',
    });
    expect(text).toMatch(/Russian/i);
  });

  test('parseRequiredLanguages handles JSON', () => {
    expect(parseRequiredLanguages('["Mandarin","Spanish"]')).toEqual(['Mandarin', 'Spanish']);
  });
});
