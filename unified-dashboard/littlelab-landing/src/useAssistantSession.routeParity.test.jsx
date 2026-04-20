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
  beforeEach(() => {
    const api = require('./landingAssistantApi');
    jest.clearAllMocks();
    api.getOrCreateLandingSessionId.mockReturnValue('sid-test');
    api.resolveMiddlewareApiBase.mockReturnValue('http://localhost:4000');
    api.fetchLandingResultSnapshot.mockResolvedValue({ success: true, session_result_snapshot: {} });
    api.incrementLandingVoiceMetric.mockResolvedValue({ success: true });
    api.publishLandingVoiceTimeline.mockResolvedValue({ success: true });
    api.publishLandingThreadEvent.mockResolvedValue({ success: true });
    api.submitLandingResultEdit.mockResolvedValue({ success: true });
    api.sendLandingAssistantTurn.mockResolvedValue({
      success: true,
      reply: 'ok',
      session_id: 'sid-test',
      next_step: ''
    });
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });

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

  test('sanitizes ingredient HTML before publishing barcode thread event', async () => {
    const { useAssistantSession } = require('./useAssistantSession');
    const api = require('./landingAssistantApi');
    const mockedFacts = {
      data_source: 'live_api',
      category_route: 'food',
      category_route_source: 'taxonomy_map',
      category_route_confidence: 'high',
      category_route_rule_id: 'rule:food',
      category_route_fallback: false,
      scan_summary: { schema_version: '1', tiles: {} },
      product: {
        barcode: '3033490000282',
        product_name: 'Fruit Snack',
        ingredients_text: 'FRUIT PUREE, <span class="allergen">PEACH</span>, SUGAR',
        categories_tags: ['en:fruit-snacks']
      }
    };
    api.fetchBarcodeFactsAutodetect.mockResolvedValue({ facts: mockedFacts, resolvedCatalog: 'off' });

    const { result } = renderHook(() => useAssistantSession());
    expect(result.current.apiBase).toBeTruthy();
    await act(async () => {
      await result.current.ingestScannedBarcode('3033490000282');
    });

    let barcodeContextCall;
    await waitFor(() => {
      barcodeContextCall = api.publishLandingThreadEvent.mock.calls
        .map((x) => x[0])
        .find((payload) => payload && payload.eventType === 'barcode_product_context');
      expect(barcodeContextCall).toBeTruthy();
    });
    expect(String(barcodeContextCall.text || '')).toContain('Ingredients: FRUIT PUREE, PEACH, SUGAR');
    expect(String(barcodeContextCall.text || '')).not.toMatch(/<span|<\/span>/i);
    expect(String(barcodeContextCall.productData?.ingredients_text || '')).toBe('FRUIT PUREE, PEACH, SUGAR');
  });

  test('food route scan uses non-cosmetic ingredient flags', async () => {
    const { useAssistantSession } = require('./useAssistantSession');
    const api = require('./landingAssistantApi');
    const mockedFacts = {
      data_source: 'live_api',
      category_route: 'food',
      category_route_source: 'taxonomy_map',
      category_route_confidence: 'high',
      category_route_rule_id: 'rule:food',
      category_route_fallback: false,
      scan_summary: { schema_version: '1', tiles: {} },
      product: {
        barcode: '3033490000283',
        product_name: 'Candy',
        ingredients_text: 'water, fragrance, palm oil, sucralose',
        categories_tags: ['en:candy']
      }
    };
    api.fetchBarcodeFactsAutodetect.mockResolvedValue({ facts: mockedFacts, resolvedCatalog: 'off' });

    const { result } = renderHook(() => useAssistantSession());
    expect(result.current.apiBase).toBeTruthy();
    await act(async () => {
      await result.current.ingestScannedBarcode('3033490000283');
    });
    await waitFor(() => {
      expect(result.current.scanResult).toBeTruthy();
    });
    expect(result.current.scanResult.categoryRoute).toBe('food');
    expect(result.current.scanResult.ingredientFlags.hasFragrance).toBe(false);
    expect(result.current.scanResult.ingredientFlags.hasPalmOil).toBe(false);
    expect(result.current.scanResult.ingredientFlags.hasSweeteners).toBe(true);
    expect(result.current.scanResult.ingredientFlags.applicableRoute).toBe('non_cosmetic');
  });

  test('scan flow reproduction: route fallback metric is emitted through voice-metrics helper', async () => {
    const { useAssistantSession } = require('./useAssistantSession');
    const api = require('./landingAssistantApi');
    const mockedFacts = {
      data_source: 'live_api',
      // Deliberately omit server route fields to force client fallback metric emission.
      category_route_source: null,
      category_route_confidence: null,
      category_route_rule_id: null,
      category_route_fallback: null,
      scan_summary: { schema_version: '1', tiles: {} },
      product: {
        barcode: '3033490000999',
        product_name: 'Fallback Route Product',
        ingredients_text: 'water, sugar',
        categories_tags: ['en:beverages']
      }
    };
    api.fetchBarcodeFactsAutodetect.mockResolvedValue({ facts: mockedFacts, resolvedCatalog: 'off' });

    const { result } = renderHook(() => useAssistantSession());
    await act(async () => {
      await result.current.ingestScannedBarcode('3033490000999');
    });

    await waitFor(() => {
      expect(api.incrementLandingVoiceMetric).toHaveBeenCalled();
    });
    expect(api.incrementLandingVoiceMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'scan.category_route.client_fallback_used',
        sessionId: 'sid-test'
      })
    );
  });

  test('chat composer unlocks after turn response even while TTS continues', async () => {
    const { useAssistantSession } = require('./useAssistantSession');
    const speech = require('./assistantSpeech');
    let releaseTts;
    speech.speakAssistantReply.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTts = resolve;
        })
    );
    const { result } = renderHook(() => useAssistantSession());

    let pendingTurn;
    act(() => {
      pendingTurn = result.current.sendUserMessage('Explain this scan result briefly.');
    });

    await waitFor(() => {
      expect(result.current.sending).toBe(false);
    });

    await act(async () => {
      releaseTts();
      await pendingTurn;
    });
  });
});
