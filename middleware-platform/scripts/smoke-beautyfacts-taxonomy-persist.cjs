#!/usr/bin/env node
'use strict';

async function run() {
  const base = String(process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  const barcode = String(process.env.BEAUTYFACTS_BARCODE || '3337875696548').trim();
  const expectPersist = String(process.env.EXPECT_TAXONOMY_PERSIST || '1') === '1';
  const url = `${base}/api/public/beautyfacts/${encodeURIComponent(barcode)}`;

  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(`beautyfacts request failed: status=${res.status} body=${JSON.stringify(body)}`);
  }
  if (expectPersist) {
    if (!body?.taxonomy?.product_id) {
      throw new Error('expected taxonomy.product_id in response when EXPECT_TAXONOMY_PERSIST=1');
    }
    if (!body?.taxonomy?.grade?.grade_class) {
      throw new Error('expected taxonomy.grade.grade_class in response when EXPECT_TAXONOMY_PERSIST=1');
    }
  }
  console.log(
    `beautyfacts taxonomy smoke: PASS barcode=${body?.barcode || barcode} product_id=${body?.taxonomy?.product_id || 'n/a'} grade=${body?.taxonomy?.grade?.grade_class || 'n/a'}`
  );
}

run().catch((err) => {
  console.error('beautyfacts taxonomy smoke: FAIL', err?.message || err);
  process.exit(1);
});
