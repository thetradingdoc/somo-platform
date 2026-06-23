#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const Queue = require('../services/shared/reasoning-job-queue-service');

function parseArg(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || fallback).trim();
}

function main() {
  const status = parseArg('--status', '');
  const limit = Number(parseArg('--limit', '50')) || 50;
  const rows = Queue.listReasoningJobs({ status, limit });
  console.log(JSON.stringify({
    success: true,
    status: status || 'all',
    count: rows.length,
    jobs: rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      snapshot_id: r.snapshot_id,
      snapshot_version: r.snapshot_version,
      context_hash: r.context_hash,
      status: r.status,
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      run_at: r.run_at,
      last_error: r.last_error
    }))
  }, null, 2));
}

main();
