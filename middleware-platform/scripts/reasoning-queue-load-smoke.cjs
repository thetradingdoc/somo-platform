#!/usr/bin/env node
/**
 * Lightweight local smoke: enqueue + claim throughput (no HTTP). For soak/load beyond this,
 * use k6/Artillery against real endpoints in staging.
 *
 * Env:
 *   REASONING_LOAD_ITERATIONS — default 200
 *   DB_PATH
 *
 * Usage (from middleware-platform/):
 *   node scripts/reasoning-queue-load-smoke.cjs
 */

'use strict';
/* eslint-disable no-console */

const crypto = require('crypto');
const db = require('../database').db;
const Queue = require('../services/reasoning-job-queue-service');

function main() {
  const n = Math.max(10, Math.min(5000, Number(process.env.REASONING_LOAD_ITERATIONS || 200)));
  const sid = `load-smoke-${crypto.randomUUID()}`;
  const t0 = Date.now();
  let enq = 0;
  for (let i = 0; i < n; i += 1) {
    const out = Queue.enqueueReasoningJob({
      sessionId: sid,
      snapshotId: `snap-${i}`,
      snapshotVersion: 1,
      contextHash: `ctx-${i}`,
      inputHash: `in-${i}`,
      maxAttempts: 2
    });
    if (out?.enqueued) enq += 1;
  }
  const t1 = Date.now();
  let claims = 0;
  let job;
  while ((job = Queue.claimNextReasoningJob('load-smoke-worker'))) {
    Queue.markReasoningJobObsolete(job.id, 'load_smoke_cleanup');
    claims += 1;
    if (claims > n + 5) break;
  }
  const t2 = Date.now();
  try {
    db.prepare('DELETE FROM reasoning_jobs WHERE session_id = ?').run(sid);
  } catch (_) {}
  console.log(
    JSON.stringify(
      {
        success: true,
        session_id: sid,
        iterations: n,
        enqueued_unique: enq,
        claims,
        enqueue_ms: t1 - t0,
        claim_ms: t2 - t1
      },
      null,
      2
    )
  );
}

main();
