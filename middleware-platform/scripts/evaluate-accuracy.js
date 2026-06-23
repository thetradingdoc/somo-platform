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
const REPORT_PATH = path.resolve(__dirname, '../tmp/coding-accuracy-report.json');

const casesPath = path.join(__dirname, '../tests/medical-coding/voice-agent-test-cases.json');
if (!fs.existsSync(casesPath)) {
  console.error('❌ voice-agent-test-cases.json not found at', casesPath);
  process.exit(2);
}
const { cases } = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

const { detectRedFlags, checkBeforeScheduling } = require('../services/clinical/triage-service');
const knowledgeService = require('../services/shared/knowledge-service');

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

async function evaluateCodingCase(testCase) {
  const { id, input, expected, category } = testCase;
  const result = { id, category, checks: [] };

  if (expected?.icd10_contains?.length) {
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
  console.log(`Threshold: ${ACCURACY_THRESHOLD}%\n`);

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

  const report = {
    generated_at: new Date().toISOString(),
    total: results.length,
    passed,
    accuracy_pct: accuracy,
    threshold_pct: ACCURACY_THRESHOLD,
    by_category: byCategory,
    results
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\n' + '─'.repeat(50));
  console.log(`Accuracy: ${passed}/${results.length} = ${accuracy}%`);
  console.log(`Report: ${REPORT_PATH}`);

  if (accuracy >= ACCURACY_THRESHOLD) {
    console.log('\n✅ Accuracy threshold met.\n');
    process.exit(0);
  }
  console.log(`\n❌ Accuracy below threshold (${accuracy}% < ${ACCURACY_THRESHOLD}%).\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('❌ Evaluation failed:', err);
  process.exit(1);
});
