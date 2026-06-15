'use strict';

const { extractAsrTiming } = require('../services/kelly-asr-gate');
const Metrics = require('../services/metrics');
const { recordSttTurn } = require('../services/voice-speech-metrics');

describe('speech metrics wiring', () => {
  it('extractAsrTiming reads Retell metadata fields', () => {
    const t = extractAsrTiming({
      latency_ms: 420,
      audio_duration_ms: 1800
    });
    expect(t.latencyMs).toBe(420);
    expect(t.audioDurationMs).toBe(1800);
  });

  it('recordSttTurn increments counters and gauges when callId set', () => {
    recordSttTurn({
      callId: 'call_test_metrics',
      confidence: 0.92,
      latencyMs: 300,
      audioDurationMs: 1200,
      transcript: 'hello world'
    });
    const all = Metrics.getAll();
    expect(all.counters['voice.speech.stt_turns']).toBeGreaterThan(0);
    expect(all.gauges['voice.speech.confidence_last']).toBe(0.92);
    expect(all.gauges['voice.speech.rtf_last']).toBeCloseTo(0.25, 2);
  });
});
