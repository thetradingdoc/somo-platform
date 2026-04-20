#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const Queue = require('../services/reasoning-job-queue-service');

function parseArg(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || fallback).trim();
}

function main() {
  const id = parseArg('--id', '');
  if (!id) {
    console.error(JSON.stringify({ success: false, error: '--id is required' }, null, 2));
    process.exit(1);
  }
  const out = Queue.markReasoningJobCancelled(id);
  if (!out.success) {
    console.error(JSON.stringify({ success: false, id, error: 'job_not_cancellable_or_missing' }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ success: true, id, status: 'cancelled' }, null, 2));
}

main();
