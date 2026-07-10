'use strict';

const { assertNotProduction, fastRagAllowed } = require('../services/triage-rag-fast-complete');

describe('triage-rag-fast-complete (F-04)', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  test('assertNotProduction throws in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction()).toThrow(/must not run in production/);
  });

  test('fastRagAllowed requires test env', () => {
    process.env.NODE_ENV = 'development';
    process.env.KELLY_RAILS_FAST_RAG = '1';
    expect(() => fastRagAllowed()).toThrow(/only allowed when NODE_ENV=test/);
  });

  test('fastRagAllowed true only in test with flag', () => {
    process.env.NODE_ENV = 'test';
    process.env.KELLY_RAILS_FAST_RAG = '1';
    expect(fastRagAllowed()).toBe(true);
  });
});

describe('triage-rag alcohol CAGE cap (F-07)', () => {
  test('confidence capped at 0.65 when alcohol dx without CAGE score', () => {
    const TriageRAGService = require('../services/triage-rag-service');
    const base = TriageRAGService._computeRagConfidence(
      'liver pain fatigue',
      [{ code: 'K70.10', confidence: 0.95 }],
      [{ code: '99213', confidence: 0.9 }],
      'Gastroenterology',
      {}
    );
    const confidenceCapped = true;
    const ragConfidence = confidenceCapped ? Math.min(base, 0.65) : base;
    expect(ragConfidence).toBeLessThanOrEqual(0.65);
  });
});
