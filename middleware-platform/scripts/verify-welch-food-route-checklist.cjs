#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const {
  buildScanSummary,
  buildResultSummary,
  applyReasoningPatch,
} = require('../services/product-summary-service');
const ReasoningService = require('../services/result-summary-reasoning-service');

const WELCH_INGREDIENTS = `
FRUIT PUREE (PEAR, <span class="allergen">PEACH</span>, STRAWBERRY, RASPBERRY, BLACKBERRY, BLUEBERRY AND CHERRY),
CORN SYRUP, SUGAR, MODIFIED CORN STARCH, MODIFIED TAPIOCA STARCH, <span class="allergen">GELATIN</span>,
PECTIN, CITRIC ACID, LACTIC ACID, NATURAL AND ARTIFICIAL FLAVORS, ASCORBIC ACID, COCONUT OIL, CARNAUBA WAX, RED 40, BLUE 1.
`.trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const product = {
    barcode: '0034856008125',
    product_name: "Welch's Family Farmed Fruit Snacks",
    source: 'open_food_facts',
    ingredients_text: WELCH_INGREDIENTS,
    categories_tags: ['en:fruit-snacks', 'en:snacks']
  };
  const categoryRoute = 'food';

  const scanSummary = buildScanSummary({
    product,
    categoryRoute,
    categoryRouteSource: 'taxonomy_map',
    categoryRouteRuleId: 'rule:food',
    catalogSource: 'open_food_facts'
  });

  const baseSummary = buildResultSummary({
    scanSummary,
    product,
    hasProfileContext: false,
    routineConflicts: [],
    categoryRoute,
    reasoningEnabled: true
  });

  const patch = await ReasoningService.buildReasoningPatch({
    snapshot: {
      scanned_product: { ...product, category_route: categoryRoute },
      result_summary: baseSummary,
      routine_conflicts: []
    },
    inputHash: 'welch-check'
  });
  const finalSummary = applyReasoningPatch(baseSummary, patch, { enabled: true, inputHash: 'welch-check' });

  // Food route checks
  assert(scanSummary.tiles.key_actives.reason_unavailable === 'not_applicable_cosmetic_actives', 'key_actives reason must be route-safe');
  assert(scanSummary.tiles.function.reason_unavailable === 'not_applicable_cosmetic_function', 'function reason must be route-safe');
  assert(scanSummary.tiles.skin_type.reason_unavailable === 'not_applicable_cosmetic_function', 'skin_type reason must be route-safe');
  assert(String(finalSummary.verdict.harmful.summary || '').toLowerCase().includes('retinoid') === false, 'food route must not emit retinoid warning');
  assert(String(finalSummary.verdict.harmful.summary || '').toLowerCase().includes('exfoliant') === false, 'food route must not emit exfoliant warning');
  assert(String(finalSummary.verdict.children_safe.answer || '') === 'caution', 'children safety should be caution for Red 40/Blue 1');

  const out = {
    success: true,
    barcode: product.barcode,
    product_name: product.product_name,
    route: categoryRoute,
    checks: {
      no_cosmetic_tile_reasons: true,
      no_retinoid_or_exfoliant_warning: true,
      child_safety_dye_caution: true
    },
    verdict_preview: {
      harmful_summary: finalSummary.verdict.harmful.summary,
      harmful_flags: finalSummary.verdict.harmful.flags,
      children_safe: finalSummary.verdict.children_safe
    }
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message || String(e) }, null, 2));
  process.exit(1);
});

