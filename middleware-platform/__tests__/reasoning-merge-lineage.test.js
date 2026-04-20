'use strict';

const crypto = require('crypto');
const dbMod = require('../database');
const SnapshotService = require('../services/session-result-snapshot-service');
const ReasoningJobQueue = require('../services/reasoning-job-queue-service');
const { ReasoningMergeStaleError } = SnapshotService;

describe('reasoning merge lineage (atomic snapshot merge)', () => {
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
            text: '[Barcode Scan] Merge Lineage Product (0123456789012)',
            product_data: {
              barcode: '0123456789012',
              product_name: 'Merge Lineage Product',
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
  });

  afterEach(() => {
    delete process.env.RESULT_SUMMARY_REASONING_V1;
    delete process.env.RESULT_SUMMARY_REASONING_MODEL_V1;
  });

  test('applySessionResultReasoningPatch bumps snapshot_version on merge', () => {
    const sid = `merge-ver-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'merge_ver_1' });
      expect(built.snapshot.snapshot_version).toBe(1);
      const out = SnapshotService.applySessionResultReasoningPatch({
        sessionId: sid,
        expectedSnapshotId: built.snapshot_id,
        inputHash: 'merge-v-hash',
        reasoningPatch: {
          reasoning_mode: 'stub',
          reasoning_model: 'deterministic-stub',
          reasoning_version: 'v1',
          reasoning_input_hash: 'merge-v-hash',
          reasoning_claim_provenance: {
            'verdict.good_for_me.summary': [
              { source: 'model_reasoning:direct', doc_id_ref: 'm:1', evidence_snippet_key: 'x' }
            ]
          },
          verdict: {
            good_for_me: {
              summary: 'Merged line.',
              summary_confidence: 0.95
            }
          }
        }
      });
      expect(out.snapshot.snapshot_version).toBe(2);
      expect(out.snapshot.reasoning_mode).toBe('stub');
      expect(out.snapshot.reasoning_version).toBe('v1');
    } finally {
      cleanupSession(sid);
    }
  });

  test('mergeLineage mismatch throws ReasoningMergeStaleError', () => {
    const sid = `merge-stale-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const built = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'merge_stale_1' });
      expect(() =>
        SnapshotService.applySessionResultReasoningPatch({
          sessionId: sid,
          expectedSnapshotId: built.snapshot_id,
          inputHash: 'x',
          mergeLineage: { snapshotVersion: 999, contextHash: 'wrong' },
          reasoningPatch: {
            reasoning_mode: 'stub',
            reasoning_input_hash: 'x',
            verdict: { good_for_me: { summary: 'nope', summary_confidence: 0.99 } }
          }
        })
      ).toThrow(ReasoningMergeStaleError);
    } finally {
      cleanupSession(sid);
    }
  });

  test('second baseline moves latest snapshot id; worker marks superseded jobs obsolete', async () => {
    const sid = `merge-race-${crypto.randomUUID()}`;
    try {
      seedBarcodeThreadEvent(sid, 'food');
      const first = SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'race_a' });
      SnapshotService.buildSessionResultSnapshot({ sessionId: sid, source: 'race_b' });
      const latest = SnapshotService.getLatestSessionResultSnapshot(sid);
      expect(String(latest.snapshot_id)).not.toBe(String(first.snapshot_id));
      dbMod.db.prepare('DELETE FROM reasoning_jobs WHERE session_id = ?').run(sid);
      const jobId = crypto.randomUUID();
      const ins = dbMod.db
        .prepare(
          `INSERT INTO reasoning_jobs (
            id, session_id, snapshot_id, snapshot_version, context_hash, input_hash, job_key,
            status, attempts, max_attempts, run_at, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, 3, datetime('now', '-5 minutes'), '{}', datetime('now'), datetime('now'))`
        )
        .run(
          jobId,
          sid,
          first.snapshot_id,
          Number(first.snapshot.snapshot_version),
          String(first.snapshot.context_hash || ''),
          'race-hash',
          `${sid}::${first.snapshot.snapshot_version}::${String(first.snapshot.context_hash || '')}::manual`
        );
      expect(ins.changes).toBe(1);
      const ReasoningService = require('../services/result-summary-reasoning-service');
      await ReasoningService.processReasoningJobs({ maxJobs: 3 });
      const row = dbMod.db.prepare('SELECT status, last_error FROM reasoning_jobs WHERE id = ?').get(jobId);
      expect(row?.status).toBe('obsolete');
      expect(String(row?.last_error || '')).toContain('snapshot_superseded');
    } finally {
      cleanupSession(sid);
    }
  });
});
