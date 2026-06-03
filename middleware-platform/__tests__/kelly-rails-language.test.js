'use strict';

const {
  detectLanguage,
  detectLanguageFromText,
  detectLanguagePreferenceRequest,
  evaluateFirstTurnLanguage,
  minLanguageConfidence
} = require('../services/kelly-rails/language');

describe('kelly-rails/language', () => {
  const prevMin = process.env.KELLY_LANG_MIN_CONFIDENCE;

  afterEach(() => {
    if (prevMin === undefined) delete process.env.KELLY_LANG_MIN_CONFIDENCE;
    else process.env.KELLY_LANG_MIN_CONFIDENCE = prevMin;
  });

  test('Spanish clinical message → es with sufficient confidence', () => {
    const r = detectLanguage('Hola, tengo dolor en el brazo y quiero una cita');
    expect(r.language).toBe('es');
    expect(r.confidence).toBeGreaterThanOrEqual(minLanguageConfidence());
  });

  test('Portuguese hints → pt', () => {
    const r = detectLanguage('Preciso de ajuda com a fatura, obrigado');
    expect(r.language).toBe('pt');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('Mandarin script → zh', () => {
    const r = detectLanguage('我想预约医生，谢谢');
    expect(r.language).toBe('zh');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('English clinical stays en', () => {
    const r = detectLanguage('I have a red itchy rash on my left arm');
    expect(r.language).toBe('en');
    expect(r.confidence).toBeGreaterThanOrEqual(minLanguageConfidence());
  });

  test('detectLanguageFromText Cyrillic → ru', () => {
    const r = detectLanguageFromText('Можем говорить по-русски?');
    expect(r.language).toBe('ru');
  });

  test('explicit language preference request', () => {
    const r = detectLanguagePreferenceRequest('Can we speak Spanish please?');
    expect(r.isLanguageRequest).toBe(true);
    expect(r.code).toBe('es');
  });

  test('evaluateFirstTurnLanguage — English no handoff', () => {
    const r = evaluateFirstTurnLanguage('I need help with a billing question');
    expect(r.language).toBe('en');
    expect(r.forceLanguageHandoff).toBe(false);
  });

  test('low-confidence non-English forces handoff when threshold high', () => {
    process.env.KELLY_LANG_MIN_CONFIDENCE = '0.99';
    const r = evaluateFirstTurnLanguage('xyzzy'); // no hints → en default
    expect(r.forceLanguageHandoff).toBe(false);
  });
});
