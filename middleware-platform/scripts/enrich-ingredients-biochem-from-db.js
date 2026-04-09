#!/usr/bin/env node
'use strict';

const db = require('../database').db;
const { upsertBiochemFromCanonicalName } = require('../services/ingredient-biochem-repository');

async function run() {
  const cols = db.prepare('PRAGMA table_info(product_ingredients)').all().map((c) => c.name);
  const hasNorm = cols.includes('normalized_inci');
  const limit = Number(process.env.BIOCHEM_ENRICH_LIMIT || 50) || 50;
  const sql = hasNorm
    ? `
    SELECT k AS key FROM (
      SELECT DISTINCT LOWER(TRIM(COALESCE(NULLIF(TRIM(normalized_inci), ''), inci_name))) AS k
      FROM product_ingredients
    )
    WHERE k IS NOT NULL AND LENGTH(k) > 1
    LIMIT ?
  `
    : `
    SELECT k AS key FROM (
      SELECT DISTINCT LOWER(TRIM(inci_name)) AS k
      FROM product_ingredients
    )
    WHERE k IS NOT NULL AND LENGTH(k) > 1
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(limit);
  let n = 0;
  for (const { key } of rows) {
    await upsertBiochemFromCanonicalName(String(key).toLowerCase());
    n++;
  }
  console.log(`ingredient biochem enrich: processed ${n} distinct keys`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
