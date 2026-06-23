#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Ranked backlog of unresolved INCI tokens (impact = frequency in product_ingredients).
 * Use with human review: synonyms → upsertIngredientAlias; parsing junk → fix parseInciText / noise rules.
 *
 * Usage:
 *   node scripts/ingredient-alias-report.cjs [--limit 50] [--tsv]
 */
const db = require('../database');
const { getTopUnresolvedInciTokens, getIngredientResolutionMetrics } = require('../services/catalog/ingredient-resolution-metrics');

function parseArgs(argv) {
  let limit = 50;
  let tsv = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') limit = parseInt(argv[++i], 10) || 50;
    else if (argv[i] === '--tsv') tsv = true;
  }
  return { limit, tsv };
}

function main() {
  const { limit, tsv } = parseArgs(process.argv);
  const metrics = getIngredientResolutionMetrics();
  const gaps = getTopUnresolvedInciTokens(limit);

  if (tsv) {
    console.log(['rank', 'count', 'token', 'suggested_canonical_todo'].join('\t'));
    gaps.forEach((row, i) => {
      console.log([i + 1, row.n, row.inci_name, 'TODO'].join('\t'));
    });
    return;
  }

  console.log('=== ingredient resolution snapshot ===');
  if (metrics.error) console.log('metrics error:', metrics.error);
  else {
    console.log(`total_rows: ${metrics.total_rows}`);
    console.log(`pct_resolved_exact_or_alias: ${metrics.pct_resolved_exact_or_alias}%`);
    console.log('by_match_method:', JSON.stringify(metrics.by_match_method, null, 2));
  }
  console.log('');
  console.log('RANK | COUNT | RAW_TOKEN (inci_name) | review_hint');
  console.log('-'.repeat(90));
  gaps.forEach((row, index) => {
    const token = row.inci_name;
    const snippet = `db.upsertIngredientAlias(${JSON.stringify(token)}, 'CANONICAL_INCI_TODO', 'high-freq gap', 'gap_report');`;
    console.log(`${String(index + 1).padStart(4)} | ${String(row.n).padStart(5)} | ${token} | ${snippet}`);
  });
  console.log('');
  console.log('SQL sanity (match_method distribution on product_ingredients):');
  try {
    const rows = db.db
      .prepare(
        `
      SELECT match_method, COUNT(*) AS count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM product_ingredients), 2) AS pct
      FROM product_ingredients
      GROUP BY match_method
      ORDER BY count DESC
    `
      )
      .all();
    console.table(rows);
  } catch (e) {
    console.warn('distribution query failed:', e.message);
  }
  console.log('');
  console.log('After curating aliases, re-run: node scripts/re-resolve-catalog-ingredients.cjs');
}

main();
