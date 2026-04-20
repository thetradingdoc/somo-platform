#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const {
  buildScanSummary,
  buildResultSummary,
  applyReasoningPatch,
} = require('../services/product-summary-service');
const ReasoningService = require('../services/result-summary-reasoning-service');

const OUT_DIR = path.resolve(__dirname, '..', 'test-results');
const OUT_FILE = path.resolve(OUT_DIR, `reasoning-eval-baseline-${Date.now()}.json`);

const CASES = [
  {
    id: 'food-dyes-welch',
    route: 'food',
    product: {
      product_name: "Welch's Family Farmed Fruit Snacks",
      ingredients_text: 'fruit puree, sugar, citric acid, red 40, blue 1',
      categories_tags: ['en:fruit-snacks']
    },
    expect: { child_caution: true, no_cosmetic_alt: true, no_cosmetic_lexicon: true }
  },
  {
    id: 'cosmetic-niacinamide',
    route: 'cosmetic',
    product: {
      product_name: 'Niacinamide Serum',
      ingredients_text: 'water, niacinamide, zinc pca, phenoxyethanol, fragrance',
      categories_tags: ['en:serums']
    },
    expect: { cosmetic_alternatives_allowed: true }
  }
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function hasCosmeticLexicon(text) {
  return /\bretinoid|tone_evening|anti_aging|blemish_control|barrier_support\b/i.test(String(text || ''));
}

function scoreCase(result) {
  const verdict = result?.summary?.verdict || {};
  const route = result?.route;
  const harmfulText = `${verdict?.harmful?.summary || ''} ${(Array.isArray(verdict?.harmful?.flags) ? verdict.harmful.flags.join(' ') : '')}`;
  const alternatives = Array.isArray(verdict?.alternatives?.candidates) ? verdict.alternatives.candidates : [];
  const out = {
    route_safety: 0,
    harm_precision: 0,
    child_safety: 0,
    notes: []
  };
  if (route === 'food') {
    if (!hasCosmeticLexicon(harmfulText)) out.route_safety += 1;
    else out.notes.push('food route emitted cosmetic lexicon');
    if (!alternatives.length) out.route_safety += 1;
    else out.notes.push('food route emitted alternatives candidates');
    if (String(verdict?.children_safe?.answer || '') === 'caution') out.child_safety += 1;
    else out.notes.push('expected child caution for food dye case');
    if ((Array.isArray(verdict?.harmful?.flags) ? verdict.harmful.flags.length : 0) === 0) out.harm_precision += 1;
  } else if (route === 'cosmetic') {
    if (alternatives.length > 0) out.route_safety += 1;
    if (/phenoxyethanol|fragrance/i.test(harmfulText)) out.harm_precision += 1;
    if (String(verdict?.children_safe?.answer || '') !== 'safe') out.child_safety += 1;
  }
  return out;
}

async function runOne(tc) {
  const scanSummary = buildScanSummary({
    product: tc.product,
    categoryRoute: tc.route,
    categoryRouteSource: 'eval_harness',
    categoryRouteRuleId: 'eval_harness',
    catalogSource: tc.route === 'cosmetic' ? 'open_beauty_facts' : 'open_food_facts'
  });
  const deterministic = buildResultSummary({
    scanSummary,
    product: tc.product,
    hasProfileContext: true,
    routineConflicts: [],
    categoryRoute: tc.route,
    reasoningEnabled: false
  });
  process.env.RESULT_SUMMARY_REASONING_MODEL_V1 = 'true';
  ReasoningService.__setModelCallerForTests(async () => ({
    model: 'eval-model',
    version: 'eval-model-v1',
    rawText: JSON.stringify({
      verdict: {
        good_for_me: { summary: 'Eval summary', detail: 'Eval detail', summary_confidence: 0.9, detail_confidence: 0.9 },
        harmful: {
          flags: tc.route === 'cosmetic' ? ['Fragrance allergens present'] : [],
          top_evidence: tc.route === 'cosmetic' ? 'Phenoxyethanol and fragrance detected.' : 'No elevated food risk beyond deterministic.',
          summary: tc.route === 'cosmetic' ? 'Potential irritation risk.' : 'No immediate high-risk signal.',
          flags_confidence: 0.9,
          top_evidence_confidence: 0.9,
          summary_confidence: 0.9
        },
        children_safe: { summary: 'Child guidance', summary_confidence: 0.9 },
        side_effects: { summary: 'Side effects eval', summary_confidence: 0.9 },
        alternatives: {
          candidates: tc.route === 'cosmetic' ? ['Fragrance-free ceramide moisturizer'] : ['Should be suppressed'],
          footer: 'Eval alternatives',
          candidates_confidence: 0.9
        }
      },
      reasoning_confidence_global: 0.9,
      reasoning_evidence_summary: 'Eval evidence summary'
    }),
    usage: { input_tokens: 120, output_tokens: 80 }
  }));
  const patch = await ReasoningService.buildReasoningPatch({
    snapshot: {
      scanned_product: { ...tc.product, category_route: tc.route },
      result_summary: deterministic,
      routine_conflicts: []
    },
    inputHash: `eval:${tc.id}`
  });
  const modelBacked = applyReasoningPatch(deterministic, patch, { enabled: true, inputHash: `eval:${tc.id}` });
  return {
    id: tc.id,
    route: tc.route,
    deterministic_score: scoreCase({ route: tc.route, summary: deterministic }),
    model_score: scoreCase({ route: tc.route, summary: modelBacked }),
    model_reasoning_mode: modelBacked?.reasoning?.reasoning_mode || null
  };
}

async function main() {
  const started = Date.now();
  const rows = [];
  for (const tc of CASES) {
    rows.push(await runOne(tc));
  }
  const aggregate = rows.reduce((acc, r) => {
    for (const k of ['route_safety', 'harm_precision', 'child_safety']) {
      acc.deterministic[k] += Number(r.deterministic_score[k] || 0);
      acc.model[k] += Number(r.model_score[k] || 0);
    }
    return acc;
  }, {
    deterministic: { route_safety: 0, harm_precision: 0, child_safety: 0 },
    model: { route_safety: 0, harm_precision: 0, child_safety: 0 }
  });

  const report = {
    success: true,
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
    case_count: rows.length,
    aggregate,
    cases: rows
  };
  ensureDir(OUT_DIR);
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, out_file: OUT_FILE }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message || String(e) }, null, 2));
  process.exit(1);
});

