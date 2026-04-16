#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Batch re-resolve INCI text → product_ingredients via replaceProductIngredientsFromInciText.
 * Usage:
 *   node scripts/re-resolve-catalog-ingredients.cjs [--limit N] [--dry-run]
 */
const db = require('../database');

function parseArgs(argv) {
  let limit = null;
  let dry = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') dry = true;
  }
  return { limit, dry };
}

async function main() {
  const { limit, dry } = parseArgs(process.argv);
  const q = `
    SELECT id, inci_text FROM products_catalog
    WHERE inci_text IS NOT NULL AND trim(inci_text) != ''
    ORDER BY updated_at DESC
    ${Number.isFinite(limit) && limit > 0 ? `LIMIT ${limit}` : ''}
  `;
  const rows = db.db.prepare(q).all();
  console.log(`[re-resolve] products with inci_text: ${rows.length}${dry ? ' (dry-run)' : ''}`);
  let n = 0;
  for (const r of rows) {
    if (dry) {
      n += 1;
      continue;
    }
    const out = db.replaceProductIngredientsFromInciText(r.id, r.inci_text);
    if (out?.success) n += 1;
  }
  const metrics = db.getIngredientResolutionMetricsSnapshot ? db.getIngredientResolutionMetricsSnapshot() : {};
  console.log('[re-resolve] updated:', n);
  console.log('[metrics]', JSON.stringify(metrics, null, 2));
}

main().catch((e) => {
  console.error('[re-resolve] fatal:', e);
  process.exit(1);
});
