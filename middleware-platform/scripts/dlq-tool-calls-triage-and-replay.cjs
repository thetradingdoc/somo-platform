#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const db = require('../database');
const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'docs', 'runbooks');
const OUT_FILE = path.resolve(OUT_DIR, 'DLQ_TOOL_CALLS_INCIDENT_NOTE.md');

function classifyErrorType(message = '') {
  const m = String(message || '').toLowerCase();
  if (/timeout|timed out|etimedout/.test(m)) return 'timeout';
  if (/auth|unauthorized|forbidden|401|403/.test(m)) return 'auth';
  if (/schema|validation|invalid|parse/.test(m)) return 'validation';
  if (/depend|dns|network|econn|enotfound|upstream|rate limit|429|5\d\d/.test(m)) return 'dependency';
  return 'unknown';
}

function isRetrySafe(entry) {
  const t = classifyErrorType(entry?.error_message || '');
  const fn = String(entry?.function_name || '').trim().toLowerCase();
  if (fn === 'checkout_backfill_reconciliation') return true;
  return t === 'timeout' || t === 'dependency';
}

async function replayOne(entry) {
  let args = {};
  try {
    args = JSON.parse(String(entry.parameters_json || '{}'));
  } catch (_) {
    return { attempted: false, success: false, reason: 'invalid_parameters_json' };
  }
  try {
    const out = await KellyToolExecutor.execute(
      String(entry.function_name || 'unknown'),
      args,
      {
        sessionId: `dlq-replay-${entry.id}`,
        clinicId: entry.clinic_id || null,
        patientId: null,
        callerPhone: null,
        channel: 'chat'
      }
    );
    const ok = !!out && out.success !== false;
    if (ok && db.db) {
      db.db.prepare('DELETE FROM dlq_tool_calls WHERE id = ?').run(entry.id);
    }
    return { attempted: true, success: ok, reason: ok ? 'replayed_and_removed' : 'replay_failed' };
  } catch (e) {
    return { attempted: true, success: false, reason: e.message || 'replay_error' };
  }
}

async function main() {
  const rows = typeof db.getDlqToolCalls === 'function' ? db.getDlqToolCalls(500) : [];
  const beforeSize = typeof db.getDlqToolCallsSize === 'function' ? Number(db.getDlqToolCallsSize() || 0) : rows.length;

  const breakdown = {};
  const retrySafe = [];
  for (const r of rows) {
    const type = classifyErrorType(r.error_message);
    const key = `${type}:${String(r.function_name || 'unknown')}`;
    breakdown[key] = (breakdown[key] || 0) + 1;
    if (isRetrySafe(r)) retrySafe.push(r);
  }

  let replayAttempts = 0;
  let replaySuccess = 0;
  for (const r of retrySafe) {
    const res = await replayOne(r);
    if (res.attempted) replayAttempts += 1;
    if (res.success) replaySuccess += 1;
  }

  const afterSize = typeof db.getDlqToolCallsSize === 'function' ? Number(db.getDlqToolCallsSize() || 0) : 0;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const stableCheck = typeof db.getDlqToolCallsSize === 'function' ? Number(db.getDlqToolCallsSize() || 0) : afterSize;

  const replayRate = replayAttempts > 0 ? Number((replaySuccess / replayAttempts).toFixed(4)) : 1;

  const lines = [
    '# DLQ Tool Calls Incident Note',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Backlog',
    `- Before replay: ${beforeSize}`,
    `- After replay: ${afterSize}`,
    `- Stable check (1s): ${stableCheck}`,
    `- Threshold (50): ${afterSize < 50 ? 'below' : 'at_or_above'}`,
    '',
    '## Breakdown (error_type:function_name)',
    ...Object.entries(breakdown).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Retry Replay',
    `- Retry-safe entries: ${retrySafe.length}`,
    `- Replay attempts: ${replayAttempts}`,
    `- Replay success: ${replaySuccess}`,
    `- Replay success rate: ${replayRate}`,
    '',
    '## Classification Rules',
    '- timeout: timeout/timed out/etimedout',
    '- dependency: upstream/network/rate-limit/5xx/dns/connection',
    '- auth: unauthorized/forbidden/401/403',
    '- validation: schema/validation/invalid/parse',
    ''
  ];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`);

  console.log(JSON.stringify({
    success: true,
    before_size: beforeSize,
    after_size: afterSize,
    stable_size: stableCheck,
    below_threshold: afterSize < 50,
    retry_safe: retrySafe.length,
    replay_attempts: replayAttempts,
    replay_success: replaySuccess,
    replay_success_rate: replayRate,
    incident_note: OUT_FILE
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message || String(e) }, null, 2));
  process.exit(1);
});

