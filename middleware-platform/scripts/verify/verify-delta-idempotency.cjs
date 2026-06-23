#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const db = require('../../database');

async function main() {
  const filename = `delta-idempotency-${Date.now()}.json.gz`;
  const a = db.recordObfDeltaApplied({ filename, rows_seen: 10, rows_upserted: 8, rows_failed: 2 });
  const b = db.recordObfDeltaApplied({ filename, rows_seen: 10, rows_upserted: 8, rows_failed: 2 });
  if (!a?.success || !b?.success) throw new Error('recordObfDeltaApplied failed');
  const count = db.countObfDeltaAppliedByFilename(filename);
  if (count !== 1) throw new Error(`expected exactly one applied row for filename; got ${count}`);
  console.log(`[verify-delta-idempotency] PASS filename=${filename} count=${count}`);
}

main().catch((e) => {
  console.error('[verify-delta-idempotency] FAIL', e.message || e);
  process.exit(1);
});

