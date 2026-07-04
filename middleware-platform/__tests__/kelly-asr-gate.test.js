'use strict';

const { evaluateAsr, minAsrConfidence } = require('../services/kelly-asr-gate');

describe('kelly-asr-gate', () => {
  const prev = process.env.KELLY_ASR_MIN_CONFIDENCE;

  afterEach(() => {
    if (prev === undefined) delete process.env.KELLY_ASR_MIN_CONFIDENCE;
    else process.env.KELLY_ASR_MIN_CONFIDENCE = prev;
  });

  test('gate uses config default when env unset', () => {
    delete process.env.KELLY_ASR_MIN_CONFIDENCE;
    expect(minAsrConfidence()).toBe(0.75);
    const r = evaluateAsr('hola', { confidence: 0.1 });
    expect(r.allow).toBe(false);
  });

  test('blocks below threshold', () => {
    process.env.KELLY_ASR_MIN_CONFIDENCE = '0.8';
    const r = evaluateAsr('test', { confidence: 0.5 }, { locale: 'es' });
    expect(r.allow).toBe(false);
    expect(r.clarifyReply).toMatch(/repetir|repeat/i);
  });

  test('allows above threshold', () => {
    process.env.KELLY_ASR_MIN_CONFIDENCE = '0.8';
    const r = evaluateAsr('test', { confidence: 0.9 });
    expect(r.allow).toBe(true);
  });
});
