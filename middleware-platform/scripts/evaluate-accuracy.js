#!/usr/bin/env node
/**
 * Evaluate medical coding accuracy against voice-agent-test-cases.
 *
 * Uses getCodeCandidatesDualSource (ICD + CPT) with optional semantic search.
 *
 * Usage:
 *   npm run eval:coding
 *   SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding  # fast regression (voice-aligned)
 *   ACCURACY_THRESHOLD=60 node scripts/evaluate-accuracy.js
 *   EVAL_PAIR_CATEGORY_THRESHOLD=95 node scripts/evaluate-accuracy.js
 *
 * Env: RAG_API_URL defaults to `disabled` when unset. EVAL_USE_SEMANTIC=false skips embedding hybrid (faster).
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';
// Eval uses local DB + semantic; skip Colab RAG localhost timeout unless RAG_API_URL is set for remote
if (!process.env.RAG_API_URL?.trim()) {
  process.env.RAG_API_URL = 'disabled';
}

const ACCURACY_THRESHOLD = parseInt(process.env.ACCURACY_THRESHOLD || '60', 10);
const FAST_EVAL = process.env.EVAL_USE_SEMANTIC === 'false';
// K-02 / nightly measures medical dual-source path; dental uses phrase-map + `verify:dental-pstn-eval`.
const EXCLUDE_DENTAL = FAST_EVAL || process.env.EVAL_MEDICAL_ONLY !== '0';
const EVAL_PAIR_CATEGORY_THRESHOLD = FAST_EVAL
  ? 0
  : parseInt(process.env.EVAL_PAIR_CATEGORY_THRESHOLD || '75', 10);
const REPORT_PATH = path.resolve(__dirname, '../tmp/coding-accuracy-report.json');

const casesPath = path.join(__dirname, '../tests/medical-coding/voice-agent-test-cases.json');
if (!fs.existsSync(casesPath)) {
  console.error('❌ voice-agent-test-cases.json not found at', casesPath);
  process.exit(2);
}
const { cases: allCases } = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
// Dental handoff uses admin phrase-map path — validated via verify:dental-pstn-eval, not dual-source recall.
const cases = EXCLUDE_DENTAL
  ? allCases.filter((c) => c.category !== 'dental_handoff' && !c.skip_fast_eval)
  : allCases;

const { detectRedFlags, checkBeforeScheduling } = require('../services/triage-service');
const knowledgeService = require('../services/knowledge-service');
const { resolveAdminInsuranceCodes } = require('../services/resolve-admin-visit-codes');
const { selectPrimaryIcd10, selectPrimaryProcedure } = require('../services/select-primary-codes');

const RANKING_BASELINE_PATH = path.resolve(__dirname, '../tmp/coding-ranking-baseline.json');
const EVAL_PRIMARY = process.env.EVAL_PRIMARY_RANKING !== 'false';

function codeMatchesPrefix(actualCodes, expectedPrefixes) {
  const norm = (actualCodes || []).map((c) => String(c).replace(/\./g, '').toUpperCase());
  return (expectedPrefixes || []).some((prefix) => {
    const p = String(prefix).replace(/\./g, '').toUpperCase();
    return norm.some((c) => c.startsWith(p) || c.includes(p));
  });
}

function recallAtK(actualCodes, expectedPrefixes, k) {
  if (!expectedPrefixes?.length) return true;
  const top = (actualCodes || []).slice(0, k).map((c) => (typeof c === 'object' ? c.code : c));
  return codeMatchesPrefix(top, expectedPrefixes);
}

function primaryMatchesPrefix(actual, expectedPrefixes) {
  if (!actual || !expectedPrefixes?.length) return false;
  const norm = String(actual).replace(/\./g, '').toUpperCase();
  return expectedPrefixes.some((prefix) => {
    const p = String(prefix).replace(/\./g, '').toUpperCase();
    return norm.startsWith(p) || norm.includes(p);
  });
}

function rankPrimariesFromDual(dual, input = '') {
  const icd10 = dual.icd10 || [];
  const cpt = dual.cpt || [];
  const hcpcs = dual.hcpcs || [];
  const telehealthIntent = /telehealth|video visit/i.test(input);
  const primary_icd10 = selectPrimaryIcd10(icd10, []);
  const procedurePick = selectPrimaryProcedure({
    cptCandidates: cpt,
    hcpcsCandidates: hcpcs,
    primaryIcd10: primary_icd10,
    telehealthIntent,
    preferEm: true
  });
  return {
    primary_icd10,
    primary_cpt: procedurePick.code_type === 'cpt' ? procedurePick.code : null,
    primary_hcpcs: procedurePick.code_type === 'hcpcs' ? procedurePick.code : null
  };
}

async function evaluateCodingCase(testCase) {
  const { id, input, expected, category } = testCase;
  const result = { id, category, checks: [] };

  if (category === 'preventive' && expected?.cpt_contains?.length) {
    try {
      const admin = resolveAdminInsuranceCodes({
        visit_reason: input,
        tenantSpecialty: 'healthcare_clinic'
      });
      const icd10 = admin.ok && admin.primary_icd10 ? [admin.primary_icd10] : [];
      const cpt = admin.ok && admin.primary_cpt ? [admin.primary_cpt] : [];
      if (expected.icd10_contains?.length) {
        const icdOk = recallAtK(icd10, expected.icd10_contains, 5);
        result.checks.push({
          field: 'icd10_recall@5',
          expected: expected.icd10_contains,
          actual: icd10,
          passed: icdOk
        });
      }
      const cptOk = recallAtK(cpt, expected.cpt_contains, 5);
      result.checks.push({
        field: 'cpt_recall@5',
        expected: expected.cpt_contains,
        actual: cpt,
        passed: cptOk && admin.ok
      });
    } catch (e) {
      result.checks.push({ field: 'preventive_admin', passed: false, error: e.message });
    }
  } else if (expected?.icd10_contains?.length) {
    try {
      const dual = await knowledgeService.getCodeCandidatesDualSource(input, {
        maxIcd10: 10,
        maxCpt: 10,
        useSemantic: process.env.EVAL_USE_SEMANTIC !== 'false'
      });
      const icd10 = (dual.icd10 || []).map((c) => c.code);
      const cpt = (dual.cpt || []).map((c) => c.code);
      const hcpcs = (dual.hcpcs || []).map((c) => c.code);
      const icdOk = recallAtK(icd10, expected.icd10_contains, 5);
      result.checks.push({
        field: 'icd10_recall@5',
        expected: expected.icd10_contains,
        actual: icd10.slice(0, 5),
        passed: icdOk
      });
      if (expected.cpt_contains?.length) {
        const cptOk = recallAtK(cpt, expected.cpt_contains, 5);
        result.checks.push({
          field: 'cpt_recall@5',
          expected: expected.cpt_contains,
          actual: cpt.slice(0, 5),
          passed: cptOk
        });
      }
      if (expected.hcpcs_contains?.length) {
        const hcpcsOk = recallAtK(hcpcs, expected.hcpcs_contains, 5);
        result.checks.push({
          field: 'hcpcs_recall@5',
          expected: expected.hcpcs_contains,
          actual: hcpcs.slice(0, 5),
          passed: hcpcsOk
        });
      }
      if (EVAL_PRIMARY) {
        const ranked = rankPrimariesFromDual(dual, input);
        if (expected.primary_icd10_prefix?.length) {
          const icdPrimaryOk = primaryMatchesPrefix(ranked.primary_icd10, expected.primary_icd10_prefix);
          result.checks.push({
            field: 'primary_icd10',
            expected: expected.primary_icd10_prefix,
            actual: ranked.primary_icd10,
            passed: icdPrimaryOk
          });
        }
        if (expected.primary_cpt) {
          const cptPrimaryOk = ranked.primary_cpt === expected.primary_cpt;
          result.checks.push({
            field: 'primary_cpt',
            expected: expected.primary_cpt,
            actual: ranked.primary_cpt,
            passed: cptPrimaryOk
          });
        } else if (expected.primary_cpt_in && expected.cpt_contains?.length) {
          const cptPrimaryOk = primaryMatchesPrefix(ranked.primary_cpt, expected.cpt_contains);
          result.checks.push({
            field: 'primary_cpt_in_recall',
            expected: expected.cpt_contains,
            actual: ranked.primary_cpt,
            passed: cptPrimaryOk
          });
        }
      }
    } catch (e) {
      result.checks.push({ field: 'dual_source', passed: false, error: e.message });
    }
  }

  if (category === 'voice_emergency' || expected?.urgency) {
    const triage = detectRedFlags(input);
    const scheduling = checkBeforeScheduling([{ role: 'user', content: input }]);
    if (expected?.urgency) {
      result.checks.push({
        field: 'urgency',
        expected: expected.urgency,
        actual: triage?.urgency,
        passed: (triage?.urgency || 'ROUTINE') === expected.urgency
      });
    }
    if (expected?.blocks_scheduling != null) {
      result.checks.push({
        field: 'blocks_scheduling',
        expected: expected.blocks_scheduling,
        actual: scheduling?.blockScheduling,
        passed: scheduling?.blockScheduling === expected.blocks_scheduling
      });
    }
  }

  result.passed = result.checks.length > 0 && result.checks.every((c) => c.passed);
  return result;
}

function aggregateByCategory(results) {
  const byCat = {};
  for (const r of results) {
    if (!byCat[r.category]) byCat[r.category] = { total: 0, passed: 0 };
    byCat[r.category].total++;
    if (r.passed) byCat[r.category].passed++;
  }
  return byCat;
}

async function main() {
  console.log('\n📊 Medical Coding Accuracy Evaluation');
  console.log('═'.repeat(50));
  console.log(`Test cases: ${cases.length}`);
  console.log(`Threshold: ${ACCURACY_THRESHOLD}%`);
  console.log(`Pair validation category threshold: ${EVAL_PAIR_CATEGORY_THRESHOLD}%\n`);

  const results = [];
  for (const tc of cases) {
    const r = await evaluateCodingCase(tc);
    results.push(r);
    const status = r.passed ? '✅' : '❌';
    console.log(`${status} ${r.id} (${r.category})`);
    for (const c of r.checks) {
      console.log(`   ${c.passed ? '✓' : '✗'} ${c.field}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const accuracy = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;
  const byCategory = aggregateByCategory(results);
  const pairCat = byCategory.pair_validation;
  const pairPct = pairCat && pairCat.total > 0
    ? Math.round((pairCat.passed / pairCat.total) * 100)
    : 100;

  const report = {
    generated_at: new Date().toISOString(),
    total: results.length,
    passed,
    accuracy_pct: accuracy,
    threshold_pct: ACCURACY_THRESHOLD,
    pair_validation_threshold_pct: EVAL_PAIR_CATEGORY_THRESHOLD,
    pair_validation_accuracy_pct: pairPct,
    primary_ranking_enabled: EVAL_PRIMARY,
    by_category: byCategory,
    results
  };

  if (process.env.EVAL_WRITE_RANKING_BASELINE === '1') {
    const primaryRows = results
      .filter((r) => r.checks.some((c) => c.field.startsWith('primary_')))
      .map((r) => ({
        id: r.id,
        category: r.category,
        checks: r.checks.filter((c) => c.field.startsWith('primary_'))
      }));
    fs.mkdirSync(path.dirname(RANKING_BASELINE_PATH), { recursive: true });
    fs.writeFileSync(
      RANKING_BASELINE_PATH,
      JSON.stringify({ version: 1, frozen_at: new Date().toISOString(), cases: primaryRows }, null, 2)
    );
    console.log(`Ranking eval snapshot: ${RANKING_BASELINE_PATH}`);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\n' + '─'.repeat(50));
  console.log(`Accuracy: ${passed}/${results.length} = ${accuracy}%`);
  if (pairCat) {
    console.log(`Pair validation: ${pairCat.passed}/${pairCat.total} = ${pairPct}% (threshold ${EVAL_PAIR_CATEGORY_THRESHOLD}%)`);
  }
  console.log(`Report: ${REPORT_PATH}`);

  if (accuracy >= ACCURACY_THRESHOLD && pairPct >= EVAL_PAIR_CATEGORY_THRESHOLD) {
    console.log('\n✅ Accuracy threshold met.\n');
    process.exit(0);
  }
  if (accuracy < ACCURACY_THRESHOLD) {
    console.log(`\n❌ Accuracy below threshold (${accuracy}% < ${ACCURACY_THRESHOLD}%).\n`);
  } else if (EVAL_PAIR_CATEGORY_THRESHOLD > 0 && pairPct < EVAL_PAIR_CATEGORY_THRESHOLD) {
    console.log(`\n❌ Pair validation category below threshold (${pairPct}% < ${EVAL_PAIR_CATEGORY_THRESHOLD}%).\n`);
  } else {
    console.log('\n❌ Eval gate failed.\n');
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('❌ Evaluation failed:', err);
  process.exit(1);
});
