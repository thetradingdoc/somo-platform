'use strict';

const { isAllowedLandingVoiceMetricName } = require('../services/landing-voice-metrics-contract');

describe('landing-voice-metrics-contract', () => {
  test('allows exact voice metrics', () => {
    expect(isAllowedLandingVoiceMetricName('voice.interruption')).toBe(true);
    expect(isAllowedLandingVoiceMetricName('voice.stt_fatal')).toBe(true);
    expect(isAllowedLandingVoiceMetricName('voice.timeline')).toBe(true);
  });

  test('allows scan metrics emitted from scan flow', () => {
    expect(isAllowedLandingVoiceMetricName('scan.category_route.client_fallback_used')).toBe(true);
    expect(isAllowedLandingVoiceMetricName('scan.lookup_found_route_unknown.count')).toBe(true);
    expect(isAllowedLandingVoiceMetricName('scan.lookup_found_route_known.count')).toBe(true);
    expect(isAllowedLandingVoiceMetricName('scan.lookup_not_found.count')).toBe(true);
  });

  test('rejects unknown or malformed metric names', () => {
    expect(isAllowedLandingVoiceMetricName('')).toBe(false);
    expect(isAllowedLandingVoiceMetricName('payment.charge.failed')).toBe(false);
    expect(isAllowedLandingVoiceMetricName('scan.bad metric name')).toBe(false);
  });
});

