#!/usr/bin/env node
'use strict';

/**
 * Step 1 pipeline test runner
 * - keyword/intent mirror (matches current production order)
 * - voice transcript dedupe (production)
 * - phase resolution (production)
 * - entity persistence write path (production tool executor)
 *
 * Usage:
 *   node scripts/test-step1-pipeline.js
 */

const path = require('path');
const KellyOrchestratorPhase = require('../services/kelly/kelly-orchestrator-phase');
const KellyToolExecutor = require('../services/kelly/kelly-tool-executor');
const db = require('../database');
const cases = require('./test-cases');

// Mirrors current _classifyIntent ordering in kelly-agent-service.js
const BILLING_KEYWORDS = [
  'receipt', 'invoice', 'bill', 'billing', 'payment', 'charge',
  'refund', 'insurance card', 'claims', 'claim status', 'eob',
  'explanation of benefits', 'how much does', 'what does it cost',
  'what is the price', 'pricing', 'copay', 'deductible'
];

const ROUTINE_BOOKING_KEYWORDS = [
  'annual physical', 'annual check', 'wellness visit', 'routine physical',
  'routine check', 'general visit', 'general check', 'yearly physical',
  'wellness check', 'routine visit', 'annual exam', 'regular checkup',
  'just a checkup', 'just a check-up', 'prescription refill', 'refill my prescription',
  'no symptoms', "don't have symptoms", 'do not have symptoms', 'without symptoms',
  'no pain', 'just routine', 'preventive visit',
  'нет симптомов', 'без симптомов', 'только осмотр', 'профилактический осмотр'
];

const SYMPTOM_KEYWORDS = [
  'pain', 'hurt', 'ache', 'rash', 'fever', 'cough', 'nausea', 'vomit',
  'dizzy', 'bleed', 'swollen', 'swelling', 'tired', 'fatigue', 'shortness',
  'breath', 'chest', 'headache', 'stomach', 'sore', 'burning', 'itching',
  'discharge', 'lump', 'bump', 'infection', 'sick', 'ill', 'not feeling well',
  'feeling bad', 'something wrong', 'worried about'
];

function classifyIntentMirror(message) {
  const t = String(message || '').toLowerCase();
  if (BILLING_KEYWORDS.some((k) => t.includes(k))) return 'billing';
  if (ROUTINE_BOOKING_KEYWORDS.some((k) => t.includes(k))) return 'routine_booking';
  if (SYMPTOM_KEYWORDS.some((k) => t.includes(k))) return 'symptom';
  return 'unknown';
}

function assertEqual(actual, expected) {
  return actual === expected;
}

function scoreConfidenceProxy(entityInput, dedupeStats) {
  if (!entityInput || typeof entityInput !== 'object') return { score: 0, band: 'low' };
  let score = 0;
  if (entityInput.onset) score += 1;
  if (entityInput.quality) score += 1;
  if (entityInput.severity != null && entityInput.severity !== '') score += 1;
  if (entityInput.timing) score += 1;
  if (entityInput.associated_sx) score += 1;
  let band = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  // Noisy signal penalty:
  // If dedupe collapses >=20% of the transcript, confidence is capped to low.
  // This prevents over-trusting heavily repeated/garbled ASR turns.
  const before = Number(dedupeStats?.beforeLength || 0);
  const after = Number(dedupeStats?.afterLength || 0);
  const collapseRatio = before > 0 ? Math.max(0, (before - after) / before) : 0;
  const noisyPenaltyApplied = collapseRatio >= 0.2;
  if (noisyPenaltyApplied) {
    band = 'low';
  }
  return { score, band, collapseRatio, noisyPenaltyApplied };
}

function truncate(text, max = 120) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function runScenario(scenario) {
  const sessionId = `step1_${scenario.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const patientId = `p_${scenario.id}`;

  const dedupe = KellyOrchestratorPhase.dedupeConsecutiveUserFragments(scenario.message);
  const intent = classifyIntentMirror(dedupe.text);
  const orchestration = KellyOrchestratorPhase.resolveOrchestrationPhase({
    sessionId,
    message: dedupe.text,
    intentBucket: intent,
    db: {
      getTriageSession: () => null
    },
    KellyToolExecutor,
    getLatestRag: () => null,
    routineLocked: false
  });

  let entityStored = null;
  const entityInputForConfidence = scenario.entityInput || (Array.isArray(scenario.entityTurns) && scenario.entityTurns[0]) || null;
  if (scenario.entityInput || scenario.priorState || Array.isArray(scenario.entityTurns)) {
    try {
      KellyToolExecutor._setSessionMeta(sessionId, 'routine_intake_active', '1');
      if (scenario.priorState) {
        KellyToolExecutor._storeTriageOpqrst(scenario.priorState, sessionId, patientId);
      }
      let out = null;
      if (scenario.entityInput) {
        out = KellyToolExecutor._storeTriageOpqrst(scenario.entityInput, sessionId, patientId);
      }
      if (Array.isArray(scenario.entityTurns) && scenario.entityTurns.length) {
        for (const turn of scenario.entityTurns) {
          out = KellyToolExecutor._storeTriageOpqrst(turn, sessionId, patientId);
        }
      }
      const row = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      entityStored = {
        writeSuccess: !!out?.success,
        opqrst_complete: row?.opqrst_complete ?? null,
        quality: row?.quality ?? null,
        onset: row?.onset ?? null,
        skin_type: row?.skin_type ?? null,
        pregnancy_status: row?.pregnancy_status ?? null,
        functional_impact: row?.functional_impact ?? null
      };
    } catch (e) {
      entityStored = { writeSuccess: false, error: e.message };
    }
  }
  const confidence = scoreConfidenceProxy(entityInputForConfidence, dedupe);

  const checks = [];
  if (scenario.expected && scenario.expected.intent) {
    checks.push({
      name: 'intent',
      expected: scenario.expected.intent,
      actual: intent,
      pass: assertEqual(intent, scenario.expected.intent)
    });
  }
  if (scenario.expected && scenario.expected.phase) {
    checks.push({
      name: 'phase',
      expected: scenario.expected.phase,
      actual: orchestration.phase,
      pass: assertEqual(orchestration.phase, scenario.expected.phase)
    });
  }
  if (scenario.expected && Object.prototype.hasOwnProperty.call(scenario.expected, 'collapsed')) {
    checks.push({
      name: 'dedupe.collapsed',
      expected: scenario.expected.collapsed,
      actual: dedupe.collapsed,
      pass: assertEqual(dedupe.collapsed, scenario.expected.collapsed)
    });
  }
  if (scenario.expected && scenario.expected.confidenceBand) {
    checks.push({
      name: 'confidenceBand(proxy)',
      expected: scenario.expected.confidenceBand,
      actual: confidence.band,
      pass: assertEqual(confidence.band, scenario.expected.confidenceBand)
    });
  }
  if (scenario.expected && Object.prototype.hasOwnProperty.call(scenario.expected, 'onsetPreserved')) {
    const preserved = entityStored && entityStored.onset === scenario.priorState?.onset;
    checks.push({
      name: 'onsetPreserved',
      expected: scenario.expected.onsetPreserved,
      actual: preserved,
      pass: assertEqual(preserved, scenario.expected.onsetPreserved)
    });
  }

  const knownFailure = !!scenario.knownFailure;
  const effectiveChecks = knownFailure ? checks.filter((c) => !c.pass) : checks;
  const treatedPass = knownFailure ? true : checks.every((c) => c.pass);

  return {
    id: scenario.id,
    label: scenario.label,
    input: truncate(scenario.message),
    dedupe,
    intent,
    phase: orchestration.phase,
    checks,
    entityStored,
    confidence,
    knownFailure,
    knownFailureReason: scenario.knownFailureReason || null,
    treatedPass,
    knownFailureMisses: knownFailure ? effectiveChecks.map((c) => c.name) : []
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const results = cases.map(runScenario);
  const knownFailureCount = results.filter((r) => r.knownFailure).length;
  const normalResults = results.filter((r) => !r.knownFailure);
  const totalChecks = normalResults.reduce((sum, r) => sum + r.checks.length, 0);
  const passedChecks = normalResults.reduce((sum, r) => sum + r.checks.filter((c) => c.pass).length, 0);
  const failedKnownFailures = results
    .filter((r) => r.knownFailure)
    .map((r) => ({ id: r.id, misses: r.knownFailureMisses }));

  const summary = {
    started_at: startedAt,
    test_file: path.relative(process.cwd(), __filename),
    scenarios: results.length,
    known_failures: knownFailureCount,
    mode: 'english_first',
    checks: {
      passed: passedChecks,
      total: totalChecks,
      failed: totalChecks - passedChecks
    },
    known_failure_details: failedKnownFailures
  };

  console.log(JSON.stringify({ summary, results }, null, 2));

  if (passedChecks !== totalChecks) {
    process.exitCode = 1;
  }
}

main();

