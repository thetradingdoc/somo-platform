'use strict';

const crypto = require('crypto');
const dbMod = require('../database');

describe('reasoning shadow worker', () => {
  function seedBarcodeThreadEvent(sessionId, categoryRoute = 'food') {
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
            text: '[Barcode Scan] Shadow Worker Product (0123456789012)',
            product_data: {
              barcode: '0123456789012',
              product_name: 'Shadow Worker Product',
              ingredients_text: 'water, sugar, citric acid',
              category_route: categoryRoute,
              category_route_confidence: 'high',
              category_route_fallback: false,
              category_route_source: 'taxonomy_map'
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
    try {
      dbMod.db.prepare('DELETE FROM reasoning_jobs WHERE session_id = ?').run(sessionId);
    } catch (_) {}
  }

  afterEach(() => {
    delete process.env.RESULT_SUMMARY_REASONING_V1;
    delete process.env.RESULT_SUMMARY_REASONING_MODEL_V1;
    delete process.env.RESULT_SUMMARY_REASONING_SHADOW_V1;
    jest.resetModules();
  });

  test('processReasoningJobs skips snapshot merge when shadow flag is on', async () => {
    const sid = `shadow-worker-${crypto.randomUUID()}`;
    const schedSpy = jest.spyOn(global, 'setImmediate').mockImplementation(() => 0);
    try {
      process.env.RESULT_SUMMARY_REASONING_V1 = 'true';
      process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'false';
      process.env.RESULT_SUMMARY_REASONING_SHADOW_V1 = 'true';
      jest.resetModules();
      const Snap = require('../services/session-result-snapshot-service');
      const ReasoningService = require('../services/result-summary-reasoning-service');
      const applySpy = jest.spyOn(Snap, 'applySessionResultReasoningPatch');

      seedBarcodeThreadEvent(sid, 'food');
      const built = Snap.buildSessionResultSnapshot({ sessionId: sid, source: 'shadow_worker_seed' });
      const verBefore = Number(built.snapshot.snapshot_version || 0);

      await ReasoningService.processReasoningJobs({ maxJobs: 6 });

      expect(applySpy).not.toHaveBeenCalled();
      const latest = Snap.getLatestSessionResultSnapshot(sid);
      expect(Number(latest.snapshot.snapshot_version || 0)).toBe(verBefore);

      const row = dbMod.db
        .prepare('SELECT status FROM reasoning_jobs WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1')
        .get(sid);
      expect(row?.status).toBe('success');
    } finally {
      schedSpy.mockRestore();
      cleanupSession(sid);
    }
  });
});
