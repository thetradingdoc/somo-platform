import { renderHook, act, waitFor } from '@testing-library/react';

jest.mock('./landingAssistantApi', () => ({
  getOrCreateLandingSessionId: jest.fn(() => 'sid-test'),
  fetchBarcodeFactsAutodetect: jest.fn(),
  fetchLandingResultSnapshot: jest.fn(async () => ({ success: true, session_result_snapshot: {} })),
  incrementLandingVoiceMetric: jest.fn(async () => ({ success: true })),
  publishLandingVoiceTimeline: jest.fn(async () => ({ success: true })),
  publishLandingThreadEvent: jest.fn(async () => ({ success: true })),
  resolveMiddlewareApiBase: jest.fn(() => 'http://localhost:4000'),
  submitLandingResultEdit: jest.fn(async () => ({ success: true })),
  sendLandingAssistantTurn: jest.fn(async () => ({ success: true, reply: 'ok', session_id: 'sid-test', next_step: '' }))
}));

jest.mock('./assistantSpeech', () => ({
  speakAssistantReply: jest.fn(async () => {}),
  stopAssistantSpeech: jest.fn(() => {}),
  waitForAssistantSpeechToFinish: jest.fn(async () => {}),
  primeAssistantAudioGate: jest.fn(() => {})
}));

jest.mock('./webVoiceTurnController', () => ({
  createWebVoiceTurnController: jest.fn(() => ({
    stop: jest.fn(),
    start: jest.fn(),
    pauseForAssistant: jest.fn(),
    isPaused: jest.fn(() => false),
    resumeAfterAssistant: jest.fn(async () => {})
  }))
}));

describe('useAssistantSession parity', () => {
  test('sendUserMessage and ingestScannedBarcode produce same route metadata', async () => {
    const { useAssistantSession } = require('./useAssistantSession');
    const api = require('./landingAssistantApi');
    const mockedFacts = {
      data_source: 'obf_index_cache',
      category_route: 'unknown',
      category_route_source: 'taxonomy_map',
      category_route_confidence: 'low',
      category_route_rule_id: 'rule:test',
      category_route_fallback: 'insufficient_signal',
      scan_summary: { schema_version: '1', tiles: {} },
      product: {
        barcode: '3033490000282',
        product_name: 'Test Product',
        ingredients_text: 'Aqua, Niacinamide',
        categories_tags: ['en:unknown']
      }
    };
    api.fetchBarcodeFactsAutodetect.mockResolvedValue({ facts: mockedFacts, resolvedCatalog: 'obf' });

    const { result } = renderHook(() => useAssistantSession());
    expect(result.current.apiBase).toBeTruthy();

    let ingestOut;
    await act(async () => {
      ingestOut = await result.current.ingestScannedBarcode('3033490000282');
    });
    expect(ingestOut?.success).toBeTruthy();
    await waitFor(() => {
      expect(result.current.scanResult).toBeTruthy();
    });
    const fromIngest = result.current.scanResult;

    await act(async () => {
      await result.current.sendUserMessage('scan 3033490000282');
    });
    await waitFor(() => {
      expect(result.current.scanResult).toBeTruthy();
    });
    const fromSend = result.current.scanResult;
    expect(fromIngest.categoryRoute).toBe(fromSend.categoryRoute);
    expect(fromIngest.categoryRouteSource).toBe(fromSend.categoryRouteSource);
    expect(fromIngest.categoryRouteConfidence).toBe(fromSend.categoryRouteConfidence);
    expect(fromIngest.categoryRouteRuleId).toBe(fromSend.categoryRouteRuleId);
    expect(fromIngest.categoryRouteFallback).toBe(fromSend.categoryRouteFallback);
  });
});
