#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const Queue = require('../services/shared/reasoning-job-queue-service');
const ReasoningService = require('../services/shared/result-summary-reasoning-service');

function parseArg(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || fallback).trim();
}

async function main() {
  const id = parseArg('--id', '');
  if (!id) {
    console.error(JSON.stringify({ success: false, error: '--id is required' }, null, 2));
    process.exit(1);
  }
  const replay = Queue.replayReasoningJob(id);
  if (!replay.success) {
    console.error(JSON.stringify({ success: false, id, error: 'job_not_replayable_or_missing' }, null, 2));
    process.exit(1);
  }
  await ReasoningService.processReasoningJobs({ maxJobs: 6 });
  console.log(JSON.stringify({ success: true, id, status: 'replayed' }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message || String(e) }, null, 2));
  process.exit(1);
});
