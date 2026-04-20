'use strict';

const crypto = require('crypto');

describe('reasoning-job-queue-service', () => {
  let dbMod;
  let Queue;

  beforeEach(() => {
    jest.resetModules();
    dbMod = require('../database');
    try {
      dbMod.db.prepare('DELETE FROM reasoning_jobs').run();
    } catch (_) {}
    Queue = require('../services/reasoning-job-queue-service');
  });

  function cleanupSession(sessionId) {
    try {
      dbMod.db.prepare('DELETE FROM reasoning_jobs WHERE session_id = ?').run(sessionId);
    } catch (_) {}
  }

  test('deduplicates jobs by session+snapshot_version+context_hash', () => {
    const sid = `reasoning-job-dedupe-${crypto.randomUUID()}`;
    try {
      const first = Queue.enqueueReasoningJob({
        sessionId: sid,
        snapshotId: 'snap-1',
        snapshotVersion: 4,
        contextHash: 'ctx-abc',
        inputHash: 'in-1'
      });
      const second = Queue.enqueueReasoningJob({
        sessionId: sid,
        snapshotId: 'snap-2',
        snapshotVersion: 4,
        contextHash: 'ctx-abc',
        inputHash: 'in-2'
      });
      expect(first.enqueued).toBe(true);
      expect(second.enqueued).toBe(false);
      expect(second.duplicate).toBe(true);
    } finally {
      cleanupSession(sid);
    }
  });

  test('markReasoningJobSuccess merges execution_summary into payload_json', () => {
    const sid = `reasoning-job-exec-${crypto.randomUUID()}`;
    try {
      const queued = Queue.enqueueReasoningJob({
        sessionId: sid,
        snapshotId: 'snap-1',
        snapshotVersion: 1,
        contextHash: 'ctx-exec',
        inputHash: 'in-1',
        maxAttempts: 2,
        payload: { queued_at: 'test' }
      });
      expect(queued.enqueued).toBe(true);
      const claimed = Queue.claimNextReasoningJob('jest-exec');
      expect(claimed).toBeTruthy();
      Queue.markReasoningJobSuccess(claimed.id, {
        executionSummary: { reasoning_mode: 'stub', reasoning_retrieval: { status: 'none' } }
      });
      const row = dbMod.db.prepare('SELECT payload_json FROM reasoning_jobs WHERE id = ?').get(claimed.id);
      const payload = JSON.parse(String(row?.payload_json || '{}'));
      expect(payload.execution_summary?.reasoning_mode).toBe('stub');
      expect(payload.execution_summary?.reasoning_retrieval?.status).toBe('none');
      expect(payload.queued_at).toBe('test');
    } finally {
      cleanupSession(sid);
    }
  });

  test('retries then moves to dlq at terminal attempts', () => {
    const sid = `reasoning-job-dlq-${crypto.randomUUID()}`;
    try {
      const queued = Queue.enqueueReasoningJob({
        sessionId: sid,
        snapshotId: 'snap-1',
        snapshotVersion: 1,
        contextHash: 'ctx-dlq',
        inputHash: 'in-1',
        maxAttempts: 2
      });
      expect(queued.enqueued).toBe(true);
      const claimed = Queue.claimNextReasoningJob('jest-worker');
      expect(claimed).toBeTruthy();
      const firstFail = Queue.markReasoningJobRetryOrDlq(claimed.id, 'upstream timeout');
      expect(firstFail.action).toBe('retry');
      const secondClaim = Queue.claimNextReasoningJob('jest-worker-2');
      // If retry run_at is in the future, force status transition explicitly for deterministic test.
      const targetId = secondClaim?.id || claimed.id;
      const secondFail = Queue.markReasoningJobRetryOrDlq(targetId, 'upstream timeout');
      expect(secondFail.action).toBe('dlq');
      const row = dbMod.db.prepare('SELECT status FROM reasoning_jobs WHERE id = ?').get(targetId);
      expect(row?.status).toBe('dlq');
    } finally {
      cleanupSession(sid);
    }
  });

  test('reclaimStuckStartedReasoningJobs re-queues stale started jobs without incrementing attempts', () => {
    const sid = `reasoning-job-reclaim-${crypto.randomUUID()}`;
    try {
      const queued = Queue.enqueueReasoningJob({
        sessionId: sid,
        snapshotId: 'snap-1',
        snapshotVersion: 1,
        contextHash: 'ctx-reclaim',
        inputHash: 'in-1',
        maxAttempts: 3
      });
      expect(queued.enqueued).toBe(true);
      const claimed = Queue.claimNextReasoningJob('jest-stuck');
      expect(claimed).toBeTruthy();
      dbMod.db
        .prepare(
          `UPDATE reasoning_jobs SET heartbeat_at = datetime('now', '-2 hours'), locked_at = datetime('now', '-2 hours') WHERE id = ?`
        )
        .run(claimed.id);
      const dry = Queue.reclaimStuckStartedReasoningJobs({ olderThanMinutes: 30, dryRun: true });
      expect(dry.candidates).toBeGreaterThanOrEqual(1);
      const out = Queue.reclaimStuckStartedReasoningJobs({ olderThanMinutes: 30, dryRun: false });
      expect(out.reclaimed).toBeGreaterThanOrEqual(1);
      const row = dbMod.db.prepare(`SELECT status, attempts, last_error FROM reasoning_jobs WHERE id = ?`).get(claimed.id);
      expect(row?.status).toBe('retry');
      expect(Number(row?.attempts || 0)).toBe(0);
      expect(String(row?.last_error || '')).toContain('stuck_started_reclaimed');
    } finally {
      cleanupSession(sid);
    }
  });

  test('touchReasoningJobHeartbeat updates started job', () => {
    const sid = `reasoning-job-hb-${crypto.randomUUID()}`;
    try {
      Queue.enqueueReasoningJob({
        sessionId: sid,
        snapshotId: 'snap-hb',
        snapshotVersion: 1,
        contextHash: 'ctx-hb',
        inputHash: 'in-hb',
        maxAttempts: 2
      });
      const claimed = Queue.claimNextReasoningJob('jest-hb');
      expect(claimed).toBeTruthy();
      dbMod.db.prepare(`UPDATE reasoning_jobs SET heartbeat_at = datetime('now', '-10 minutes') WHERE id = ?`).run(claimed.id);
      Queue.touchReasoningJobHeartbeat(claimed.id);
      const row = dbMod.db.prepare(`SELECT heartbeat_at FROM reasoning_jobs WHERE id = ?`).get(claimed.id);
      expect(row?.heartbeat_at).toBeTruthy();
    } finally {
      cleanupSession(sid);
    }
  });
});
