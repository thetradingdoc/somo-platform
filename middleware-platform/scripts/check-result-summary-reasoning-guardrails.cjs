'use strict';

const fs = require('fs');
const path = require('path');
const ReasoningService = require('../services/shared/result-summary-reasoning-service');
const ProductSummaryService = require('../services/catalog/product-summary-service');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'result-summary-reasoning-eval-set.json');
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const forbiddenAny = /\b(diagnosis|diagnose|cure|guaranteed|medical advice)\b/i;

async function main() {
  let failed = 0;
  for (const tc of fixtures) {
    const patch = await ReasoningService.buildReasoningPatch({
      snapshot: tc.snapshot,
      inputHash: `fixture-${tc.id}`
    });
    const summary = String(patch?.verdict?.good_for_me?.summary || '');
    const alternatives = Array.isArray(patch?.verdict?.alternatives?.candidates)
      ? patch.verdict.alternatives.candidates
      : [];
    const blob = JSON.stringify(patch);

    for (const needle of tc.expect.good_for_me_summary_includes || []) {
      if (!summary.includes(needle)) {
        console.error(`[reasoning-guardrails] ${tc.id}: missing summary text "${needle}"`);
        failed += 1;
      }
    }
    if (alternatives.length < Number(tc.expect.alternatives_min || 0)) {
      console.error(`[reasoning-guardrails] ${tc.id}: expected at least ${tc.expect.alternatives_min} alternatives, got ${alternatives.length}`);
      failed += 1;
    }
    for (const phrase of tc.expect.forbidden_phrases || []) {
      if (new RegExp(`\\b${phrase}\\b`, 'i').test(blob)) {
        console.error(`[reasoning-guardrails] ${tc.id}: forbidden phrase detected "${phrase}"`);
        failed += 1;
      }
    }
    if (forbiddenAny.test(blob)) {
      console.error(`[reasoning-guardrails] ${tc.id}: generic forbidden wording detected`);
      failed += 1;
    }
    for (const phrase of tc.expect.forbidden_route_terms || []) {
      if (new RegExp(`\\b${phrase}\\b`, 'i').test(summary)) {
        console.error(`[reasoning-guardrails] ${tc.id}: route-forbidden term leaked into summary "${phrase}"`);
        failed += 1;
      }
    }

    if (Array.isArray(tc.expect.unsupported_field_paths) && tc.expect.unsupported_field_paths.length > 0) {
      const route = tc?.snapshot?.scanned_product?.category_route || tc?.snapshot?.result_summary?.semantic_contract?.route || 'unknown';
      const baseScan = ProductSummaryService.buildScanSummary({
        product: tc?.snapshot?.scanned_product || {},
        categoryRoute: route
      });
      const baseSummary = ProductSummaryService.buildResultSummary({
        scanSummary: baseScan,
        product: tc?.snapshot?.scanned_product || {},
        hasProfileContext: true,
        routineConflicts: tc?.snapshot?.routine_conflicts || [],
        categoryRoute: route,
        reasoningEnabled: false
      });
      if (tc?.snapshot?.result_summary?.semantic_contract) {
        baseSummary.semantic_contract = tc.snapshot.result_summary.semantic_contract;
      }
      const forced = { verdict: {} };
      for (const pathKey of tc.expect.unsupported_field_paths) {
        if (pathKey === 'verdict.good_for_me.summary') {
          forced.verdict.good_for_me = {
            summary: 'Targets tone_evening and anti_aging quickly.',
            summary_confidence: 0.95
          };
        }
      }
      const applied = ProductSummaryService.applyReasoningPatch(baseSummary, forced, { enabled: true });
      for (const pathKey of tc.expect.unsupported_field_paths) {
        if (pathKey === 'verdict.good_for_me.summary') {
          const st = String(applied?.verdict?.good_for_me?.status || '');
          if (st !== 'unsupported_for_route') {
            console.error(`[reasoning-guardrails] ${tc.id}: expected unsupported_for_route for ${pathKey}, got ${st || 'empty'}`);
            failed += 1;
          }
        }
      }
    }
  }
  if (failed > 0) {
    console.error(`[reasoning-guardrails] failed checks: ${failed}`);
    process.exit(1);
  }
  console.log(`[reasoning-guardrails] passed ${fixtures.length} fixture(s)`);
}

main().catch((err) => {
  console.error('[reasoning-guardrails] fatal:', err?.message || err);
  process.exit(1);
});
