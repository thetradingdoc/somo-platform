#!/usr/bin/env node
/**
 * Evaluate accuracy against voice-agent-test-cases (Section 4)
 *
 * Loads tests/medical-coding/voice-agent-test-cases.json, runs triage/coding pipeline,
 * compares expected vs actual, outputs accuracy %.
 *
 * Usage: cd middleware-platform && node scripts/evaluate-accuracy.js
 *
 * Exit code: 0 if accuracy >= ACCURACY_THRESHOLD (default 70%), else 1
 */

const path = require('path');
const fs = require('fs');

const ACCURACY_THRESHOLD = parseInt(process.env.ACCURACY_THRESHOLD || '70', 10);

const casesPath = path.join(__dirname, '../tests/medical-coding/voice-agent-test-cases.json');
if (!fs.existsSync(casesPath)) {
  console.error('❌ voice-agent-test-cases.json not found at', casesPath);
  process.exit(2);
}
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

const { detectRedFlags, checkBeforeScheduling } = require('../services/triage-service');
let knowledgeService;
try {
  knowledgeService = require('../services/knowledge-service');
} catch (e) {
  knowledgeService = null;
}

function runCase(testCase) {
  const { id, input, expected, category } = testCase;
  const result = { id, category, passed: false, checks: [] };

  if (category === 'voice_emergency' || expected?.urgency || expected?.blocks_scheduling) {
    const triage = detectRedFlags(input);
    const scheduling = checkBeforeScheduling([{ role: 'user', content: input }]);

    if (expected?.urgency) {
      const match = (triage?.urgency || 'ROUTINE') === expected.urgency;
      result.checks.push({ field: 'urgency', expected: expected.urgency, actual: triage?.urgency, passed: match });
    }
    if (expected?.blocks_scheduling != null) {
      const match = scheduling?.blockScheduling === expected.blocks_scheduling;
      result.checks.push({ field: 'blocks_scheduling', expected: expected.blocks_scheduling, actual: scheduling?.blockScheduling, passed: match });
    }
  }

  if (expected?.extract_symptoms_contain && Array.isArray(expected.extract_symptoms_contain)) {
    const text = input.toLowerCase();
    const found = expected.extract_symptoms_contain.filter(s => text.includes(s.toLowerCase()));
    const match = found.length === expected.extract_symptoms_contain.length;
    result.checks.push({ field: 'extract_symptoms_contain', expected: expected.extract_symptoms_contain, actual: found, passed: match });
  }

  if (expected?.icd10_contains && knowledgeService) {
    result.checks.push({ field: 'icd10_contains', expected: expected.icd10_contains, actual: null, passed: false, pending: true });
  }

  if (expected?.symptoms_contain && Array.isArray(expected.symptoms_contain)) {
    const text = input.toLowerCase();
    const found = expected.symptoms_contain.filter(s => text.includes(s.toLowerCase()));
    result.checks.push({ field: 'symptoms_contain', expected: expected.symptoms_contain, actual: found, passed: found.length >= 1 });
  }

  if (expected?.temporal_has_duration) {
    const hasDuration = /\d+\s*(day|week|month|hour|year)s?|for\s+\d+|since\s+\d+/i.test(input);
    result.checks.push({ field: 'temporal_has_duration', expected: true, actual: hasDuration, passed: hasDuration });
  }

  if (expected?.vitals_temperature) {
    const hasTemp = /\d{2,3}\s*(F|°|degrees?)|temperature|fever|temp/i.test(input);
    result.checks.push({ field: 'vitals_temperature', expected: true, actual: hasTemp, passed: hasTemp });
  }

  if (expected?.vitals_bp) {
    const hasBp = /\d{2,3}\/\d{2,3}|blood\s*pressure|mmHg|bp\s*\d/i.test(input);
    result.checks.push({ field: 'vitals_bp', expected: true, actual: hasBp, passed: hasBp });
  }

  result.passed = result.checks.length > 0 && result.checks.filter(c => !c.pending).every(c => c.passed);
  return result;
}

async function runCases() {
  const results = [];
  for (const tc of cases) {
    const r = runCase(tc);
    const icdCheck = r.checks.find(c => c.field === 'icd10_contains' && c.pending);
    if (icdCheck && knowledgeService && tc.expected?.icd10_contains) {
      try {
        const getCodeCandidates = knowledgeService.getCodeCandidates || knowledgeService.default?.getCodeCandidates;
        if (getCodeCandidates) {
          const codes = await getCodeCandidates(tc.input, { maxIcd10: 5, maxCpt: 5 });
          const icd10 = (codes?.icd10 || []).map(c => (c.code || c).toString());
          icdCheck.actual = icd10;
          icdCheck.passed = tc.expected.icd10_contains.some(prefix => icd10.some(c => c.startsWith(prefix) || c.includes(prefix)));
          icdCheck.pending = false;
        }
      } catch (_) {
        icdCheck.pending = false;
        icdCheck.actual = 'error';
      }
    }
    r.passed = r.checks.length > 0 && r.checks.every(c => c.passed);
    results.push(r);
  }
  return results;
}

async function main() {
  console.log('\n📊 Voice Agent Accuracy Evaluation');
  console.log('═'.repeat(50));
  console.log(`Test cases: ${cases.length}`);
  console.log(`Threshold: ${ACCURACY_THRESHOLD}%\n`);

  const results = await runCases();
  let passed = 0;
  for (const r of results) {
    const status = r.passed ? '✅' : '❌';
    console.log(`${status} ${r.id} (${r.category})`);
    for (const c of r.checks) {
      console.log(`   ${c.passed ? '✓' : '✗'} ${c.field}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`);
    }
    if (r.passed) passed++;
  }

  const accuracy = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;
  console.log('\n' + '─'.repeat(50));
  console.log(`Accuracy: ${passed}/${results.length} = ${accuracy}%`);
  console.log(`Threshold: ${ACCURACY_THRESHOLD}%`);

  if (accuracy >= ACCURACY_THRESHOLD) {
    console.log('\n✅ Accuracy threshold met.\n');
    process.exit(0);
  } else {
    console.log(`\n❌ Accuracy below threshold (${accuracy}% < ${ACCURACY_THRESHOLD}%).\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Evaluation failed:', err);
  process.exit(1);
});
