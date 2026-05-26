/**
 * Lay-language phrase expansions (no full codebook DB required).
 */
const path = require('path');

process.env.SKIP_STARTUP_MIGRATIONS = '1';
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ks = require('../services/knowledge-service');

describe('lay language phrase retrieval', () => {
  test('extractMedicalPhrases finds chest tightness', () => {
    const phrases = ks.extractMedicalPhrases('patient reports chest tightness and pressure');
    expect(phrases.some((p) => p.includes('chest tightness') || p === 'chest pressure')).toBe(true);
  });

  test('extractMedicalPhrases finds burning urination / UTI expansions', () => {
    const phrases = ks.extractMedicalPhrases('burning when urinating for three days');
    expect(phrases.length).toBeGreaterThan(0);
  });

  test('extractMedicalPhrases finds telehealth established patient phrases', () => {
    const phrases = ks.extractMedicalPhrases('telehealth video visit established patient anxiety');
    expect(phrases.some((p) => p.includes('established patient') || p.includes('telehealth'))).toBe(true);
  });
});
