#!/usr/bin/env node
/**
 * Re-queue reasoning jobs stuck in `started` (worker crash, deploy, long GC pause without heartbeat).
 *
 * Recommended: run every 10–15 minutes via cron or k8s CronJob.
 *
 * Env:
 *   REASONING_JOB_STUCK_AFTER_MINUTES — default 30
 *   DB_PATH — SQLite path (same as server)
 *
 * Usage:
 *   node scripts/scheduled-reclaim-stuck-reasoning-jobs.cjs
 *   node scripts/scheduled-reclaim-stuck-reasoning-jobs.cjs --dry-run
 */

'use strict';
/* eslint-disable no-console */

const Queue = require('../services/shared/reasoning-job-queue-service');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const olderThanMinutes = Math.max(
    1,
    Number(process.env.REASONING_JOB_STUCK_AFTER_MINUTES || 30)
  );
  console.log(
    `[reasoning-jobs-reclaim] dryRun=${dryRun} olderThanMinutes=${olderThanMinutes}`
  );
  const out = Queue.reclaimStuckStartedReasoningJobs({ olderThanMinutes, dryRun });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('[reasoning-jobs-reclaim] FAIL', e?.message || e);
  process.exit(1);
});
