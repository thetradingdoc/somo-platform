'use strict';

const crypto = require('crypto');

describe('session-result-snapshot route guards', () => {
  let dbMod;
  let SnapshotService;
  let nycService;

  function seedBarcodeThreadEvent(sessionId, categoryRoute) {
    dbMod.upsertOrchestrateSession({
      session_id: sessionId,
      channel: 'chat',
      preferred_language: 'en',
      turn_count: 1,
      conversation_history: [],
      flow_state: {
        short_term_thread: [
          {
            type: 'barcode_product_context',
            text: '[Barcode Scan] Route Guard Product (0123456789012)',
            product_data: {
              barcode: '0123456789012',
              product_name: 'Route Guard Product',
              ingredients_text: 'water, sugar',
              categories_tags: ['en:test'],
              category_route: categoryRoute,
              category_route_confidence: 'high',
              category_route_fallback: false,
              category_route_source: 'taxonomy_map',
              category_route_rule_id: 'rule:test',
              data_source: 'live_api',
              facts_source: categoryRoute === 'food' ? 'open_food_facts' : 'open_beauty_facts'
            }
          }
        ]
      }
    });
  }

  function cleanupSession(sessionId) {
    try {
      dbMod.wipeChatSessionClinicalState(sessionId);
    } catch (_) {}
    try {
      dbMod.db.prepare('DELETE FROM patient_orchestrate_sessions WHERE session_id = ?').run(sessionId);
    } catch (_) {}
  }

  beforeEach(() => {
    process.env.RESULT_SUMMARY_REASONING_V1 = '0';
    jest.resetModules();
    jest.doMock('../services/nyc-metal-context-service', () => ({
      buildNycMetalContext: jest.fn(() => ({
        source: 'mock_nyc',
        match_tier: 'none',
        disclaimer: 'mock',
        summary: 'mock',
        metals: [],
        sample_rows: []
      }))
    }));
    dbMod = require('../database');
    SnapshotService = require('../services/session-result-snapshot-service');
    nycService = require('../services/nyc-metal-context-service');
  });

  afterEach(() => {
    delete process.env.RESULT_SUMMARY_REASONING_V1;
  });

  test('does not attach NYC context for food route', () => {
    const sid = `snapshot-route-food-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const out = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'test_food_route' });
      expect(out?.snapshot?.scanned_product?.category_route).toBe('food');
      expect(out?.snapshot?.unified_context?.schema_version).toBe('1');
      expect(out?.snapshot?.unified_context?.route_context?.route).toBe('food');
      expect(out?.snapshot?.unified_context?.policy_pack).toBeTruthy();
      expect(out?.snapshot?.scanned_product?.nyc_metal_context).toBeUndefined();
      expect(nycService.buildNycMetalContext).not.toHaveBeenCalled();
    } finally {
      cleanupSession(sid);
    }
  });

  test('attaches NYC context for cosmetic route when enrichment exists', () => {
    const sid = `snapshot-route-cosmetic-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'cosmetic');
      const out = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'test_cosmetic_route' });
      expect(out?.snapshot?.scanned_product?.category_route).toBe('cosmetic');
      expect(out?.snapshot?.scanned_product?.nyc_metal_context?.source).toBe('mock_nyc');
      expect(nycService.buildNycMetalContext).toHaveBeenCalledTimes(1);
    } finally {
      cleanupSession(sid);
    }
  });
});

