#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const db = require('../../database');

async function main() {
  const sourceFile = `dlq-e2e-${Date.now()}.jsonl`;

  // 1) Simulate malformed row capture into DLQ.
  const bad = db.insertObfDlq({
    source_file: sourceFile,
    line_number: 1,
    error: 'parse_or_upsert_failed',
    raw_payload: '{ malformed json'
  });
  if (!bad?.success) throw new Error(`failed to insert malformed DLQ row: ${bad?.error || 'unknown'}`);

  // 2) Simulate recoverable row in DLQ (valid JSON payload).
  const recoverablePayload = JSON.stringify({
    code: '9900112233445',
    product_name: 'DLQ Recovered Product',
    ingredients_text: 'Water, Glycerin',
    categories_tags: ['en:cosmetic-product']
  });
  const good = db.insertObfDlq({
    source_file: sourceFile,
    line_number: 2,
    error: 'transient_upsert_failed',
    raw_payload: recoverablePayload
  });
  if (!good?.success) throw new Error(`failed to insert recoverable DLQ row: ${good?.error || 'unknown'}`);

  // 3) Retry flow.
  const before = db.listObfDlq(50).filter((r) => String(r.source_file || '') === sourceFile);
  if (before.length < 2) throw new Error(`expected >=2 DLQ rows before retry, got ${before.length}`);

  const { spawnSync } = require('child_process');
  const run = spawnSync('node', ['./scripts/obf-retry-dlq.cjs', '--limit', '50'], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8'
  });
  if (run.status !== 0) {
    throw new Error(`obf-retry-dlq failed: ${run.stderr || run.stdout || 'unknown error'}`);
  }

  // 4) Validate: recoverable row removed, malformed remains.
  const after = db.listObfDlq(50).filter((r) => String(r.source_file || '') === sourceFile);
  const recoveredRemoved = !after.some((r) => r.id === good.id);
  const malformedStillPresent = after.some((r) => r.id === bad.id);
  const recoveredProduct = db.getObfIndexProductByCode('9900112233445');

  if (!recoveredRemoved) throw new Error('recoverable DLQ row was not removed after retry');
  if (!malformedStillPresent) throw new Error('malformed DLQ row should remain for manual investigation');
  if (!recoveredProduct) throw new Error('recovered product not upserted into OBF index');

  console.log('[verify-dlq-retry-e2e] PASS malformed persisted + recoverable row retried and removed');
}

main().catch((e) => {
  console.error('[verify-dlq-retry-e2e] FAIL', e.message || e);
  process.exit(1);
});

