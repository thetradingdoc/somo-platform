'use strict';

const crypto = require('crypto');

describe('session-result-snapshot versioning + deterministic hashes', () => {
  let dbMod;
  let SnapshotService;

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
            text: '[Barcode Scan] Hash Stability Product (0123456789012)',
            product_data: {
              barcode: '0123456789012',
              product_name: 'Hash Stability Product',
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

  beforeEach(() => {
    process.env.RESULT_SUMMARY_REASONING_V1 = 'true';
    process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'false';
    jest.resetModules();
    dbMod = require('../database');
    SnapshotService = require('../services/session-result-snapshot-service');
  });

  afterEach(() => {
    delete process.env.RESULT_SUMMARY_REASONING_V1;
    delete process.env.RESULT_SUMMARY_REASONING_MODEL_V1;
  });

  test('increments snapshot_version and keeps context/baseline hashes stable for unchanged context', () => {
    const sid = `snapshot-version-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const first = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'version_test_1' });
      const second = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'version_test_2' });

      expect(first?.snapshot?.snapshot_version).toBe(1);
      expect(second?.snapshot?.snapshot_version).toBe(2);
      expect(first?.snapshot?.context_hash).toBeTruthy();
      expect(second?.snapshot?.context_hash).toBe(first?.snapshot?.context_hash);
      expect(first?.snapshot?.baseline_hash).toBeTruthy();
      expect(second?.snapshot?.baseline_hash).toBe(first?.snapshot?.baseline_hash);
      expect(first?.snapshot?.reasoning_state).toBe('pending');
      expect(first?.snapshot?.reasoning_fsm_pending_at).toBeTruthy();
    } finally {
      cleanupSession(sid);
    }
  });

  test('applySessionResultReasoningPatch: pending -> complete clears reasoning_fsm_pending_at', () => {
    const sid = `snapshot-fsm-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'fsm_complete' });
      expect(built.snapshot.reasoning_state).toBe('pending');
      expect(built.snapshot.reasoning_fsm_pending_at).toBeTruthy();
      const out = SnapshotService.applySessionResultReasoningPatch({
        sessionId: sid,
        expectedSnapshotId: built.snapshot_id,
        inputHash: 'fsm-hash',
        reasoningPatch: {
          reasoning_mode: 'stub',
          reasoning_model: 'deterministic-stub',
          reasoning_input_hash: 'fsm-hash',
          reasoning_claim_provenance: {
            'verdict.good_for_me.summary': [
              { source: 'model_reasoning:direct', doc_id_ref: 'model:1', evidence_snippet_key: 'gfm' }
            ]
          },
          verdict: {
            good_for_me: {
              summary: 'Grounded summary for test.',
              summary_confidence: 0.95
            }
          }
        }
      });
      expect(out.snapshot.reasoning_state).toBe('complete');
      expect(out.snapshot.snapshot_version).toBe(2);
      expect(out.snapshot.reasoning_fsm_pending_at).toBeNull();
      expect(out.snapshot.reasoning_fallback_reason).toBeNull();
      const audit = out.snapshot.reasoning_fsm_audit;
      expect(Array.isArray(audit)).toBe(true);
      expect(audit.some((r) => r.actor === 'reasoning_patch_worker')).toBe(true);
    } finally {
      cleanupSession(sid);
    }
  });

  test('applySessionResultReasoningPatch rejects stale patch when snapshot generated_at is newer than patch_built_at', () => {
    const sid = `snapshot-stale-patch-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'stale_patch_a' });
      SnapshotService.applySessionResultReasoningPatch({
        sessionId: sid,
        expectedSnapshotId: built.snapshot_id,
        inputHash: 'stale-hash-1',
        mergeLineage: {
          snapshotVersion: built.snapshot.snapshot_version,
          contextHash: String(built.snapshot.context_hash || '')
        },
        reasoningPatch: {
          patch_built_at: new Date().toISOString(),
          reasoning_mode: 'stub',
          reasoning_model: 'deterministic-stub',
          reasoning_input_hash: 'stale-hash-1',
          reasoning_claim_provenance: {
            'verdict.good_for_me.summary': [
              { source: 'model_reasoning:direct', doc_id_ref: 'model:1', evidence_snippet_key: 'gfm' }
            ]
          },
          verdict: {
            good_for_me: {
              summary: 'First merge.',
              summary_confidence: 0.95
            }
          }
        }
      });
      const latestRow = dbMod.db
        .prepare(
          `SELECT id, snapshot_json FROM session_result_snapshots WHERE session_id = ? AND is_latest = 1 ORDER BY created_at DESC LIMIT 1`
        )
        .get(sid);
      const snap = JSON.parse(String(latestRow.snapshot_json || '{}'));
      snap.generated_at = new Date(Date.now() + 120_000).toISOString();
      dbMod.db
        .prepare(`UPDATE session_result_snapshots SET snapshot_json = ? WHERE id = ?`)
        .run(JSON.stringify(snap), latestRow.id);
      expect(() =>
        SnapshotService.applySessionResultReasoningPatch({
          sessionId: sid,
          expectedSnapshotId: latestRow.id,
          inputHash: 'stale-hash-2',
          mergeLineage: {
            snapshotVersion: snap.snapshot_version,
            contextHash: String(snap.context_hash || '')
          },
          reasoningPatch: {
            patch_built_at: '2020-01-01T00:00:00.000Z',
            reasoning_mode: 'stub',
            reasoning_model: 'deterministic-stub',
            reasoning_input_hash: 'stale-hash-2',
            reasoning_claim_provenance: {
              'verdict.good_for_me.summary': [
                { source: 'model_reasoning:direct', doc_id_ref: 'model:2', evidence_snippet_key: 'gfm' }
              ]
            },
            verdict: {
              good_for_me: {
                summary: 'Should never land.',
                summary_confidence: 0.95
              }
            }
          }
        })
      ).toThrow(/ReasoningMergeStaleError|reasoning_patch_predates/i);
    } finally {
      cleanupSession(sid);
    }
  });

  test('applySessionResultReasoningPatch: pending -> fallback when gates defer', () => {
    const sid = `snapshot-fsm-fb-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'fsm_fallback' });
      expect(built.snapshot.reasoning_state).toBe('pending');
      const out = SnapshotService.applySessionResultReasoningPatch({
        sessionId: sid,
        expectedSnapshotId: built.snapshot_id,
        inputHash: 'fb-hash',
        reasoningPatch: {
          reasoning_mode: 'stub',
          reasoning_model: 'deterministic-stub',
          reasoning_input_hash: 'fb-hash',
          verdict: {
            good_for_me: {
              summary: 'Too low confidence.',
              summary_confidence: 0.05
            }
          }
        }
      });
      expect(out.snapshot.reasoning_state).toBe('fallback');
      expect(out.snapshot.reasoning_fallback_reason).toBe('gate_or_confidence');
      expect(out.snapshot.reasoning_fsm_pending_at).toBeNull();
    } finally {
      cleanupSession(sid);
    }
  });
});
