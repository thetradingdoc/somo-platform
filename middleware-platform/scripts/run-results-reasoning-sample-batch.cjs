#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const dbModule = require('../database');
const { resolveCategoryRoute } = require('../services/catalog/category-route-resolver');
const { buildScanSummary, buildResultSummary, applyReasoningPatch } = require('../services/catalog/product-summary-service');
const ReasoningService = require('../services/shared/result-summary-reasoning-service');
const { buildNycMetalContext } = require('../services/shared/nyc-metal-context-service');

const OUT_DIR = path.resolve(__dirname, '..', 'test-results');
const MANIFEST_PATH = path.resolve(__dirname, '..', 'test-fixtures', 'results-reasoning-sample-50.json');
const CATEGORY_TARGETS = {
  supplement: 10,
  meds: 10,
  food: 10,
  beauty: 10,
  hair_product: 10
};

const CATEGORY_PREFIX = {
  supplement: '91',
  meds: '90',
  food: '92',
  beauty: '93',
  hair_product: '94'
};

const MEDS_FALLBACK = Array.from({ length: 10 }, (_, i) => ({
  barcode: `90000000000${String(i + 1).padStart(2, '0')}`,
  category: 'meds',
  expected_not_found: true,
  label: `Medication control ${i + 1}`
}));

function buildFallbackControls(category, startIndex = 1, count = 10) {
  const prefix = CATEGORY_PREFIX[category] || '99';
  return Array.from({ length: count }, (_, i) => ({
    barcode: `${prefix}000000000${String(startIndex + i).padStart(2, '0')}`,
    category,
    expected_not_found: true,
    label: `${title(category)} control ${startIndex + i}`
  }));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function getIndexCounts() {
  const db = dbModule.db;
  if (!db) return { off: 0, obf: 0 };
  try {
    const off = Number(db.prepare(`SELECT COUNT(*) AS n FROM products_off_index`).get()?.n || 0);
    const obf = Number(db.prepare(`SELECT COUNT(*) AS n FROM products_obf_index`).get()?.n || 0);
    return { off, obf };
  } catch (_) {
    return { off: 0, obf: 0 };
  }
}

function parseJsonArray(raw) {
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

function title(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pickRows(sql, limit = 250) {
  const db = dbModule.db;
  if (!db) return [];
  return db.prepare(sql).all(limit);
}

function candidateFromRow(row, source) {
  const product = {
    source,
    barcode: String(row.code || row.barcode || '').trim(),
    product_name: row.product_name || null,
    brands: String(row.brands || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    categories_tags: parseJsonArray(row.categories_tags_json),
    categories_hierarchy: parseJsonArray(row.categories_hierarchy_json),
    ingredients_analysis_tags: parseJsonArray(row.ingredients_analysis_tags_json),
    ingredients_text: row.ingredients_text || '',
    image_url: row.image_url || null
  };
  const categoryEval = resolveCategoryRoute({
    source,
    categories_tags: product.categories_tags,
    categories_hierarchy: product.categories_hierarchy,
    product_name: product.product_name || '',
    brands: product.brands || [],
    ingredients_text: product.ingredients_text || ''
  });
  const nyc = buildNycMetalContext({
    productName: product.product_name,
    categoriesTags: product.categories_tags,
    ingredientsText: product.ingredients_text,
    factsSource: product.source
  });
  return {
    barcode: product.barcode,
    product,
    route: categoryEval?.route || 'unknown',
    route_meta: categoryEval,
    metal_hit: Array.isArray(nyc?.metals) && nyc.metals.some((m) => Number(m?.n_reported || 0) > 0),
    nyc
  };
}

function collectPools() {
  const foodRows = pickRows(`
    SELECT * FROM products_off_index
    WHERE ingredients_text IS NOT NULL AND TRIM(ingredients_text) != ''
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const obfRows = pickRows(`
    SELECT * FROM products_obf_index
    WHERE ingredients_text IS NOT NULL AND TRIM(ingredients_text) != ''
    ORDER BY updated_at DESC
    LIMIT ?
  `);

  const food = foodRows.map((r) => candidateFromRow(r, 'open_food_facts')).filter((x) => x.route === 'food');
  const supplement = [
    ...foodRows
      .map((r) => candidateFromRow(r, 'open_food_facts'))
      .filter((x) => /supplement|vitamin|mineral|capsule|tablet|gummy|omega|probiotic|magnesium|zinc|b12/i.test(`${x.product.product_name} ${x.product.categories_tags.join(' ')}`)),
    ...obfRows
      .map((r) => candidateFromRow(r, 'open_beauty_facts'))
      .filter((x) => x.route === 'supplement' || /supplement|vitamin|capsule|tablet|gummy/i.test(`${x.product.product_name} ${x.product.categories_tags.join(' ')}`))
  ];
  const beauty = obfRows
    .map((r) => candidateFromRow(r, 'open_beauty_facts'))
    .filter((x) => x.route === 'cosmetic' && !/shampoo|conditioner|hair|scalp|mask|pomade/i.test(`${x.product.product_name} ${x.product.categories_tags.join(' ')}`));
  const hair = obfRows
    .map((r) => candidateFromRow(r, 'open_beauty_facts'))
    .filter((x) => /shampoo|conditioner|hair|scalp|mask|pomade|hair-color|hair-care/i.test(`${x.product.product_name} ${x.product.categories_tags.join(' ')}`));
  const meds = [
    ...foodRows.map((r) => candidateFromRow(r, 'open_food_facts')),
    ...obfRows.map((r) => candidateFromRow(r, 'open_beauty_facts'))
  ].filter((x) => /ibuprofen|acetaminophen|paracetamol|cough|cold|pain|tablet|capsule|medicine|medicament|drug|syrup/i.test(`${x.product.product_name} ${x.product.categories_tags.join(' ')}`));

  return { food, supplement, beauty, hair_product: hair, meds };
}

function uniqueByBarcode(items) {
  const seen = new Set();
  return items.filter((item) => {
    const code = String(item?.barcode || '').trim();
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

function chooseMix(items, target, category) {
  const uniq = uniqueByBarcode(items);
  const hits = uniq.filter((x) => x.metal_hit);
  const misses = uniq.filter((x) => !x.metal_hit);
  const out = [];
  const pushUntil = (list) => {
    for (const item of list) {
      if (out.length >= target) break;
      if (!out.some((x) => x.barcode === item.barcode)) out.push(item);
    }
  };
  pushUntil(hits);
  pushUntil(misses);
  if (category === 'meds' && out.length < target) {
    for (const fake of MEDS_FALLBACK) {
      if (out.length >= target) break;
      out.push(fake);
    }
  }
  if (out.length < target) {
    for (const fake of buildFallbackControls(category, out.length + 1, target - out.length)) {
      if (out.length >= target) break;
      out.push(fake);
    }
  }
  return out.slice(0, target);
}

function formatTileValue(tile) {
  if (!tile) return '—';
  if (tile.status === 'available') {
    if (Array.isArray(tile.value)) {
      return tile.value.map((v) => (typeof v === 'string' ? v : (v?.display || v?.name || JSON.stringify(v)))).join(', ');
    }
    return String(tile.value ?? '—');
  }
  return String(tile.reason_unavailable || tile.status || '—');
}

function renderUserView(resultSummary = {}) {
  const verdict = resultSummary?.verdict || {};
  const tiles = resultSummary?.tiles || {};
  const reasoning = resultSummary?.reasoning || {};
  return {
    tiles: {
      key_actives: formatTileValue(tiles.key_actives),
      function: formatTileValue(tiles.function),
      skin_type: formatTileValue(tiles.skin_type),
      formulation: formatTileValue(tiles.formulation),
      safety_score: formatTileValue(tiles.safety_score)
    },
    verdict: {
      what_it_does: verdict?.product_overview?.what_it_does || '—',
      good_for_me: verdict?.good_for_me?.summary || verdict?.good_for_me?.answer || '—',
      harmful: verdict?.harmful?.summary || verdict?.harmful?.top_evidence || verdict?.harmful?.severity || '—',
      harmful_flags: Array.isArray(verdict?.harmful?.flags) ? verdict.harmful.flags : [],
      children_safe: verdict?.children_safe?.summary || verdict?.children_safe?.answer || '—',
      side_effects: verdict?.side_effects?.summary || verdict?.side_effects?.text || '—',
      alternatives: Array.isArray(verdict?.alternatives?.candidates) ? verdict.alternatives.candidates : []
    },
    reasoning: {
      status: reasoning?.status || 'none',
      model: reasoning?.reasoning_model || null,
      evidence_refs: Array.isArray(reasoning?.reasoning_evidence_refs) ? reasoning.reasoning_evidence_refs : []
    }
  };
}

async function buildResultForSample(sample) {
  if (sample.expected_not_found) {
    return {
      ok: false,
      barcode: sample.barcode,
      category: sample.category,
      product_name: sample.label,
      user_view: {
        banner: 'Not in catalog',
        subtitle: 'This barcode did not match Open Beauty Facts or Open Food Facts.'
      },
      metal_hit: false
    };
  }

  const product = sample.product;
  const categoryRoute = sample.route;
  const scanSummary = buildScanSummary({
    product,
    categoryRoute,
    categoryRouteSource: sample.route_meta?.source || null,
    categoryRouteRuleId: sample.route_meta?.rule_id || null,
    catalogSource: product.source
  });
  const baseSummary = buildResultSummary({
    scanSummary,
    product,
    hasProfileContext: true,
    routineConflicts: [],
    categoryRoute,
    reasoningEnabled: false
  });
  const reasoningPatch = await ReasoningService.buildReasoningPatch({
    snapshot: {
      scanned_product: {
        ...product,
        category_route: categoryRoute,
        nyc_metal_context: sample.nyc || null
      },
      routine_conflicts: [],
      result_summary: baseSummary
    },
    inputHash: `sample:${sample.barcode}`
  });
  const finalSummary = applyReasoningPatch(baseSummary, reasoningPatch, {
    enabled: true,
    inputHash: `sample:${sample.barcode}`
  });
  return {
    ok: true,
    barcode: sample.barcode,
    category: sample.category,
    route: categoryRoute,
    facts_source: product.source,
    product_name: product.product_name,
    metal_hit: sample.metal_hit,
    metals: sample.nyc?.metals || [],
    user_view: renderUserView(finalSummary),
    result_summary: finalSummary
  };
}

function printResult(index, total, result) {
  console.log(`\n${'='.repeat(88)}`);
  console.log(`[${index + 1}/${total}] ${title(result.category)}  |  ${result.barcode}`);
  console.log(`${'-'.repeat(88)}`);
  console.log(`Product: ${result.product_name || 'Not in catalog'}`);
  if (!result.ok) {
    console.log(`User sees: ${result.user_view.banner}`);
    console.log(`Note: ${result.user_view.subtitle}`);
    return;
  }
  console.log(`Route: ${result.route}  |  Source: ${result.facts_source}`);
  console.log(`Metals: ${result.metal_hit ? 'HIT' : 'NO HIT'}${result.metals?.length ? `  (${result.metals.map((m) => `${m.metal}:${m.max_ppm ?? 'ND'}`).join(', ')})` : ''}`);
  console.log('Tiles:');
  for (const [k, v] of Object.entries(result.user_view.tiles)) {
    console.log(`  - ${title(k)}: ${v}`);
  }
  console.log('User will see:');
  console.log(`  - What does it do?: ${result.user_view.verdict.what_it_does}`);
  console.log(`  - Good for me: ${result.user_view.verdict.good_for_me}`);
  console.log(`  - Harmful / risk: ${result.user_view.verdict.harmful}`);
  if (result.user_view.verdict.harmful_flags.length) {
    console.log(`    Flags: ${result.user_view.verdict.harmful_flags.join(' | ')}`);
  }
  console.log(`  - Good for children?: ${result.user_view.verdict.children_safe}`);
  console.log(`  - Side effects: ${result.user_view.verdict.side_effects}`);
  console.log(`  - Alternatives: ${result.user_view.verdict.alternatives.length ? result.user_view.verdict.alternatives.join(' | ') : 'None shown'}`);
  console.log(`  - Reasoning: ${result.user_view.reasoning.status}${result.user_view.reasoning.model ? ` (${result.user_view.reasoning.model})` : ''}`);
  if (result.user_view.reasoning.evidence_refs.length) {
    console.log(`    Evidence refs: ${result.user_view.reasoning.evidence_refs.join(' | ')}`);
  }
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(path.dirname(MANIFEST_PATH));
  const counts = getIndexCounts();
  if (counts.off === 0 && counts.obf === 0) {
    console.log('\n[run-results-reasoning-sample-batch] WARNING: cached catalog index is empty.');
    console.log('[run-results-reasoning-sample-batch] This will produce mostly/entirely NOT FOUND control codes.');
    console.log(
      `[run-results-reasoning-sample-batch] Hint: run with DB_PATH pointing at your populated db, e.g. DB_PATH=./middleware-dev.db`
    );
  }
  console.log(`\n[run-results-reasoning-sample-batch] index_counts: ${JSON.stringify(counts)}`);

  const pools = collectPools();
  const sampleSet = [];
  for (const [category, target] of Object.entries(CATEGORY_TARGETS)) {
    const chosen = chooseMix(pools[category] || [], target, category).map((item) => ({
      ...item,
      category
    }));
    sampleSet.push(...chosen);
  }
  const finalSet = sampleSet.slice(0, 50).map((item) => {
    if (item.expected_not_found) return item;
    return {
      barcode: item.barcode,
      category: item.category,
      metal_hit: item.metal_hit,
      route: item.route,
      route_meta: item.route_meta,
      product: item.product,
      nyc: item.nyc
    };
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(finalSet.map((x) => ({
    barcode: x.barcode,
    category: x.category,
    expected_not_found: !!x.expected_not_found,
    product_name: x.product?.product_name || x.label || null,
    route: x.route || null,
    metal_hit: !!x.metal_hit
  })), null, 2));

  const results = [];
  for (let i = 0; i < finalSet.length; i++) {
    const result = await buildResultForSample(finalSet[i]);
    results.push(result);
    printResult(i, finalSet.length, result);
  }

  const summary = {
    total: results.length,
    by_category: Object.fromEntries(
      Object.keys(CATEGORY_TARGETS).map((category) => [
        category,
        {
          total: results.filter((r) => r.category === category).length,
          metal_hit: results.filter((r) => r.category === category && r.metal_hit).length,
          not_found: results.filter((r) => r.category === category && !r.ok).length
        }
      ])
    )
  };
  const outPath = path.join(OUT_DIR, `results-reasoning-sample-batch-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`\n${'#'.repeat(88)}`);
  console.log('SUMMARY');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Report:   ${outPath}`);
}

main().catch((err) => {
  console.error('[run-results-reasoning-sample-batch]', err?.stack || err?.message || err);
  process.exit(1);
});
